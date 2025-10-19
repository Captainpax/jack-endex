import { Buffer } from 'buffer';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DEFAULT_USER_AGENT = 'jack-endex/server (+https://jack-endex.app)';
const MAX_ICON_BYTES = 4 * 1024 * 1024; // 4 MiB

function isDataImage(value) {
    return typeof value === 'string' && /^data:image\//i.test(value.trim());
}

function isHttpUrl(value) {
    if (typeof value !== 'string') return false;
    try {
        const url = new URL(value.trim());
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

async function fetchImageAsDataUri(url, { fetchImpl, logger } = {}) {
    if (!isHttpUrl(url)) {
        return null;
    }

    if (typeof fetchImpl !== 'function') {
        logger?.warn?.('[discord] Cannot fetch bot icon; fetch implementation missing.');
        return null;
    }

    let response;
    try {
        response = await fetchImpl(url, {
            method: 'GET',
            headers: {
                Accept: 'image/*',
                'User-Agent': DEFAULT_USER_AGENT,
            },
        });
    } catch (err) {
        logger?.warn?.('[discord] Failed to download bot icon from URL.', err);
        return null;
    }

    if (!response.ok) {
        logger?.warn?.(
            `[discord] Failed to download bot icon. Response status: ${response.status}.`,
        );
        return null;
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > MAX_ICON_BYTES) {
        logger?.warn?.('[discord] Bot icon exceeds 4 MiB after download; skipping update.');
        return null;
    }

    const base64 = buffer.toString('base64');
    return `data:${contentType};base64,${base64}`;
}

async function resolveIconPayload(avatarAsset, { fetchImpl, logger } = {}) {
    if (avatarAsset === undefined) {
        return undefined;
    }

    if (avatarAsset === null) {
        return null;
    }

    if (typeof avatarAsset !== 'string') {
        return null;
    }

    const trimmed = avatarAsset.trim();
    if (!trimmed) {
        return null;
    }

    if (isDataImage(trimmed)) {
        return trimmed;
    }

    if (isHttpUrl(trimmed)) {
        return fetchImageAsDataUri(trimmed, { fetchImpl, logger });
    }

    return null;
}

async function patchDiscordUser(token, payload, { fetchImpl, logger } = {}) {
    if (!payload || (payload.username === undefined && payload.avatar === undefined)) {
        return;
    }

    const response = await fetchImpl(`${DISCORD_API_BASE}/users/@me`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bot ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': DEFAULT_USER_AGENT,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        const error = new Error(
            `discord_user_update_failed:${response.status}:${text || 'unknown_error'}`,
        );
        error.status = response.status;
        error.responseText = text;
        logger?.warn?.('[discord] Discord user identity update failed.', error);
        throw error;
    }
}

async function patchDiscordApplication(token, payload, { fetchImpl, logger } = {}) {
    if (!payload || Object.keys(payload).length === 0) {
        return;
    }

    const response = await fetchImpl(`${DISCORD_API_BASE}/applications/@me`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bot ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': DEFAULT_USER_AGENT,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        const error = new Error(
            `discord_application_update_failed:${response.status}:${text || 'unknown_error'}`,
        );
        error.status = response.status;
        error.responseText = text;
        logger?.warn?.('[discord] Discord application update failed.', error);
        throw error;
    }
}

export async function updateDiscordBotIdentity({
    token,
    displayName,
    avatarAsset,
    defaultPresence,
    fetchImpl = globalThis.fetch,
    logger,
} = {}) {
    const warnings = [];

    if (!token || typeof token !== 'string' || !token.trim()) {
        return { ok: false, warnings: ['missing_token'] };
    }

    if (typeof fetchImpl !== 'function') {
        return { ok: false, warnings: ['missing_fetch'] };
    }

    const trimmedName = typeof displayName === 'string' ? displayName.trim().slice(0, 100) : undefined;
    const presenceText = typeof defaultPresence === 'string'
        ? defaultPresence.trim().slice(0, 128)
        : undefined;

    let iconPayload;
    try {
        iconPayload = await resolveIconPayload(avatarAsset, { fetchImpl, logger });
    } catch (err) {
        warnings.push('icon_resolution_failed');
        logger?.warn?.('[discord] Failed to process bot icon for update.', err);
    }

    if (iconPayload === null && avatarAsset) {
        warnings.push('icon_invalid');
    }

    const userPayload = {};
    if (trimmedName !== undefined) {
        userPayload.username = trimmedName || 'Unnamed Bot';
    }
    if (iconPayload !== undefined) {
        userPayload.avatar = iconPayload;
    }

    if (Object.keys(userPayload).length > 0) {
        try {
            await patchDiscordUser(token, userPayload, { fetchImpl, logger });
        } catch (err) {
            warnings.push('user_update_failed');
        }
    }

    const applicationPayload = {};
    if (presenceText !== undefined) {
        applicationPayload.bot = {
            presence: presenceText
                ? { status: 'online', activities: [{ name: presenceText, type: 0 }] }
                : null,
        };
    }

    if (Object.keys(applicationPayload).length > 0) {
        try {
            await patchDiscordApplication(token, applicationPayload, { fetchImpl, logger });
        } catch (err) {
            warnings.push('application_update_failed');
        }
    }

    return { ok: warnings.length === 0, warnings };
}

export default updateDiscordBotIdentity;
