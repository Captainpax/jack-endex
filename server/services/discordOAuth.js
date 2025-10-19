const DISCORD_OAUTH_TOKEN_URL = 'https://discord.com/api/oauth2/token';

function computeDiscordTokenExpiry(expiresIn, now = Date.now()) {
    const expires = Number(expiresIn);
    if (!Number.isFinite(expires) || expires <= 0) {
        return null;
    }
    const expiresAt = now + expires * 1000;
    return new Date(expiresAt);
}

function normalizeDiscordScopes(scopes) {
    if (!scopes) return undefined;
    if (Array.isArray(scopes)) {
        const normalized = scopes
            .map((scope) => (typeof scope === 'string' ? scope.trim() : String(scope || '')))
            .filter(Boolean);
        return normalized.length ? normalized : undefined;
    }
    if (typeof scopes === 'string') {
        const normalized = scopes
            .split(/\s+/)
            .map((scope) => scope.trim())
            .filter(Boolean);
        return normalized.length ? normalized : undefined;
    }
    return undefined;
}

function applyDiscordTokenResponse(user, payload, { now = Date.now() } = {}) {
    if (!user || typeof user !== 'object' || !payload || typeof payload !== 'object') {
        return user;
    }

    const accessToken = typeof payload.access_token === 'string' ? payload.access_token : '';
    if (accessToken) {
        user.discordAccessToken = accessToken;
    } else if ('access_token' in payload) {
        user.discordAccessToken = undefined;
    }

    const refreshToken = typeof payload.refresh_token === 'string' ? payload.refresh_token : '';
    if (refreshToken) {
        user.discordRefreshToken = refreshToken;
    } else if ('refresh_token' in payload && !refreshToken) {
        user.discordRefreshToken = undefined;
    }

    const expiresAt = computeDiscordTokenExpiry(payload.expires_in, now);
    if (expiresAt) {
        user.discordTokenExpiresAt = expiresAt;
    } else if ('expires_in' in payload) {
        user.discordTokenExpiresAt = undefined;
    }

    const scopes = normalizeDiscordScopes(payload.scope ?? payload.scopes);
    if (scopes) {
        user.discordScopes = scopes;
    } else if ('scope' in payload || 'scopes' in payload) {
        user.discordScopes = undefined;
    }

    return user;
}

function shouldRefreshDiscordToken(user, { bufferMs = 60_000, now = Date.now() } = {}) {
    if (!user || typeof user !== 'object') return true;
    if (!user.discordAccessToken) return true;
    if (!user.discordTokenExpiresAt) return false;

    const expiresAt = user.discordTokenExpiresAt instanceof Date
        ? user.discordTokenExpiresAt.getTime()
        : new Date(user.discordTokenExpiresAt).getTime();

    if (!Number.isFinite(expiresAt)) {
        return true;
    }

    return expiresAt - bufferMs <= now;
}

async function refreshDiscordTokens(
    user,
    { clientId, clientSecret, tokenUrl = DISCORD_OAUTH_TOKEN_URL, now = Date.now(), autoSave = true } = {},
) {
    if (!user || typeof user !== 'object') {
        throw new Error('discord_token_refresh_invalid_user');
    }

    const refreshToken = typeof user.discordRefreshToken === 'string' ? user.discordRefreshToken : '';
    if (!refreshToken) {
        throw new Error('discord_token_refresh_missing_refresh_token');
    }

    if (!clientId || !clientSecret) {
        throw new Error('discord_token_refresh_missing_client_credentials');
    }

    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
    });

    const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || typeof payload.access_token !== 'string') {
        const error = payload?.error || 'unknown_error';
        const errorDescription = payload?.error_description;
        const err = new Error(`discord_token_refresh_failed:${error}`);
        err.status = response.status;
        err.error = error;
        err.errorDescription = errorDescription;
        throw err;
    }

    applyDiscordTokenResponse(user, payload, { now });

    if (autoSave && typeof user.save === 'function') {
        await user.save();
    }

    return payload;
}

export {
    DISCORD_OAUTH_TOKEN_URL,
    applyDiscordTokenResponse,
    computeDiscordTokenExpiry,
    normalizeDiscordScopes,
    refreshDiscordTokens,
    shouldRefreshDiscordToken,
};

