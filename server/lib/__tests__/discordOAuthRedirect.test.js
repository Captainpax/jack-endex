import { describe, expect, it } from 'vitest';
import {
    buildDiscordOAuthRedirectLocation,
    sanitizeDiscordRedirectPath,
} from '../discordOAuthRedirect.js';

describe('sanitizeDiscordRedirectPath', () => {
    it('returns undefined for non-string values', () => {
        expect(sanitizeDiscordRedirectPath(null)).toBeUndefined();
        expect(sanitizeDiscordRedirectPath(undefined)).toBeUndefined();
        expect(sanitizeDiscordRedirectPath(123)).toBeUndefined();
    });

    it('normalizes relative paths', () => {
        expect(sanitizeDiscordRedirectPath('dashboard')).toBe('/dashboard');
        expect(sanitizeDiscordRedirectPath('/dashboard')).toBe('/dashboard');
    });

    it('retains query and hash segments', () => {
        expect(sanitizeDiscordRedirectPath('/dashboard?foo=bar#baz')).toBe('/dashboard?foo=bar#baz');
    });

    it('strips hostnames from absolute URLs', () => {
        expect(
            sanitizeDiscordRedirectPath('https://example.com/path/to/page?foo=bar#baz'),
        ).toBe('/path/to/page?foo=bar#baz');
    });
});

describe('buildDiscordOAuthRedirectLocation', () => {
    it('defaults to the root path when no redirect is provided', () => {
        expect(buildDiscordOAuthRedirectLocation()).toBe('/');
    });

    it('returns the redirect path when provided without an error', () => {
        expect(
            buildDiscordOAuthRedirectLocation({ redirect: '/dashboard?view=list#section' }),
        ).toBe('/dashboard?view=list#section');
    });

    it('appends the error parameter while preserving query string data', () => {
        expect(
            buildDiscordOAuthRedirectLocation({
                error: 'discord_invalid_state',
                redirect: '/dashboard?view=list',
            }),
        ).toBe('/dashboard?view=list&discordError=discord_invalid_state');
    });

    it('handles redirects that already contain a hash fragment', () => {
        expect(
            buildDiscordOAuthRedirectLocation({
                error: 'discord_user_banned',
                redirect: '/dashboard#overview',
            }),
        ).toBe('/dashboard?discordError=discord_user_banned#overview');
    });

    it('uses the redirect path captured during start', () => {
        const redirect = sanitizeDiscordRedirectPath('/dashboard');
        expect(
            buildDiscordOAuthRedirectLocation({ error: 'discord_profile_fetch_failed', redirect }),
        ).toBe('/dashboard?discordError=discord_profile_fetch_failed');
    });
});
