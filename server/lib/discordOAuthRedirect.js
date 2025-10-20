export function sanitizeDiscordRedirectPath(value) {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    try {
        const url = new URL(trimmed, 'http://localhost');
        const pathname = url.pathname.startsWith('/') ? url.pathname : `/${url.pathname}`;
        return `${pathname}${url.search}${url.hash}`;
    } catch {
        if (trimmed.startsWith('/')) {
            return trimmed;
        }
        return `/${trimmed}`;
    }
}

export function buildDiscordOAuthRedirectLocation({ error, redirect } = {}) {
    const safeRedirect = sanitizeDiscordRedirectPath(redirect) || '/';
    const url = new URL(safeRedirect, 'http://localhost');

    if (error) {
        url.searchParams.set('discordError', error);
    }

    return `${url.pathname}${url.search}${url.hash}`;
}
