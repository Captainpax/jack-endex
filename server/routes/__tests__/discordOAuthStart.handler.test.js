import { describe, expect, it, vi } from 'vitest';
import { createDiscordOAuthStartHandler } from '../discordOAuthStart.handler.js';
import {
    sanitizeDiscordRedirectPath,
    buildDiscordOAuthRedirectLocation,
} from '../../lib/discordOAuthRedirect.js';

function createResponseStub() {
    return {
        statusCode: undefined,
        body: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
}

describe('createDiscordOAuthStartHandler', () => {
    it('redirects with sanitized fallback when OAuth is not configured', async () => {
        const redirectWithSession = vi.fn(async (_req, _res, location) => {
            return location;
        });

        const handler = createDiscordOAuthStartHandler({
            getMasterBotSettings: async () => ({ oauthClientId: '', oauthRedirectUri: '' }),
            sanitizeDiscordRedirectPath,
            buildDiscordOAuthRedirectLocation,
            redirectWithSession,
            randomState: () => 'state-token',
            logger: { error: vi.fn() },
            authorizeUrl: 'https://discord.com/oauth2/authorize',
            scopes: ['identify', 'guilds'],
        });

        const req = { query: { redirect: '/login' }, session: {} };
        const res = createResponseStub();

        await handler(req, res);

        expect(redirectWithSession).toHaveBeenCalledTimes(1);
        expect(redirectWithSession).toHaveBeenCalledWith(
            req,
            res,
            '/login?discordError=discord_oauth_not_configured',
        );
        expect(res.statusCode).toBeUndefined();
        expect(res.body).toBeUndefined();
        expect(req.session.discordOAuth).toBeUndefined();
    });
});
