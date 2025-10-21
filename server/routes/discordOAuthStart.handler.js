import { URL } from 'url';

export function createDiscordOAuthStartHandler({
    getMasterBotSettings,
    sanitizeDiscordRedirectPath,
    buildDiscordOAuthRedirectLocation,
    redirectWithSession,
    randomState,
    logger,
    authorizeUrl,
    scopes,
}) {
    if (typeof getMasterBotSettings !== 'function') {
        throw new TypeError('createDiscordOAuthStartHandler requires getMasterBotSettings');
    }
    if (typeof sanitizeDiscordRedirectPath !== 'function') {
        throw new TypeError('createDiscordOAuthStartHandler requires sanitizeDiscordRedirectPath');
    }
    if (typeof buildDiscordOAuthRedirectLocation !== 'function') {
        throw new TypeError('createDiscordOAuthStartHandler requires buildDiscordOAuthRedirectLocation');
    }
    if (typeof redirectWithSession !== 'function') {
        throw new TypeError('createDiscordOAuthStartHandler requires redirectWithSession');
    }
    if (typeof randomState !== 'function') {
        throw new TypeError('createDiscordOAuthStartHandler requires randomState');
    }
    const resolvedAuthorizeUrl =
        typeof authorizeUrl === 'string' && authorizeUrl
            ? authorizeUrl
            : 'https://discord.com/oauth2/authorize';
    const resolvedScopes = Array.isArray(scopes) && scopes.length > 0 ? scopes : ['identify', 'guilds'];

    return async function discordOAuthStartHandler(req, res) {
        try {
            const settings = await getMasterBotSettings();
            const clientId =
                typeof settings?.oauthClientId === 'string' && settings.oauthClientId
                    ? settings.oauthClientId
                    : typeof settings?.oauth?.clientId === 'string'
                        ? settings.oauth.clientId
                        : '';
            const redirectUrl =
                typeof settings?.oauthRedirectUri === 'string' && settings.oauthRedirectUri
                    ? settings.oauthRedirectUri
                    : typeof settings?.oauth?.redirectUrl === 'string'
                        ? settings.oauth.redirectUrl
                        : '';

            const redirectParam = Array.isArray(req.query?.redirect)
                ? req.query.redirect[0]
                : req.query?.redirect;
            const redirectPath = sanitizeDiscordRedirectPath(redirectParam);

            if (!clientId || !redirectUrl) {
                const location = buildDiscordOAuthRedirectLocation({
                    error: 'discord_oauth_not_configured',
                    redirect: redirectPath,
                });
                await redirectWithSession(req, res, location);
                return;
            }

            const state = randomState();
            if (typeof state !== 'string' || !state) {
                throw new TypeError('randomState must return a non-empty string');
            }
            req.session.discordOAuth = {
                state,
                createdAt: Date.now(),
                ...(redirectPath ? { redirect: redirectPath } : {}),
            };

            const authorize = new URL(resolvedAuthorizeUrl);
            authorize.searchParams.set('response_type', 'code');
            authorize.searchParams.set('client_id', clientId);
            authorize.searchParams.set('scope', resolvedScopes.join(' '));
            authorize.searchParams.set('redirect_uri', redirectUrl);
            authorize.searchParams.set('state', state);
            authorize.searchParams.set('prompt', 'consent');

            await redirectWithSession(req, res, authorize.toString());
        } catch (err) {
            logger?.error?.('Failed to initiate Discord OAuth flow.', err);
            res.status(500).json({ error: 'discord_oauth_start_failed' });
        }
    };
}

export default createDiscordOAuthStartHandler;
