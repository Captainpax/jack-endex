import { idsMatch, normalizeId } from './ids';

export function describePlayer(player) {
    if (!player) return 'Unknown';
    if (typeof player === 'string') return player;
    if (player.character?.name) return player.character.name;
    if (player.username) return player.username;
    if (player.displayName) return player.displayName;
    if (player.userId) return player.userId;
    return 'Unknown';
}

function normalizeDungeonMasterSummary(dm, fallbackId) {
    if (!dm || typeof dm !== 'object') return null;
    const normalized = { ...dm };
    const resolvedId =
        normalizeId(normalized.userId) ??
        normalizeId(normalized.id) ??
        normalizeId(normalized.user?.id) ??
        normalizeId(fallbackId);
    normalized.userId = resolvedId ?? null;

    const role =
        typeof normalized.role === 'string' && normalized.role.trim() ? normalized.role.trim() : 'dm';
    normalized.role = role.toLowerCase() === 'dm' ? 'dm' : role;

    if (!normalized.username && typeof normalized.user?.username === 'string') {
        const trimmed = normalized.user.username.trim();
        if (trimmed) normalized.username = trimmed;
    }

    if (!normalized.displayName) {
        if (typeof normalized.user?.displayName === 'string') {
            const trimmed = normalized.user.displayName.trim();
            if (trimmed) normalized.displayName = trimmed;
        }
        if (!normalized.displayName && normalized.username) {
            normalized.displayName = normalized.username;
        }
    }

    return normalized;
}

export function resolveGameDungeonMaster(game) {
    if (!game) return null;
    const normalizedDmId = normalizeId(game.dmId) ?? game.dmId ?? null;

    const dmSummary =
        game.dm && typeof game.dm === 'object'
            ? normalizeDungeonMasterSummary(game.dm, normalizedDmId)
            : null;
    if (dmSummary) return dmSummary;

    const players = Array.isArray(game.players) ? game.players : [];
    if (players.length) {
        const byRole = players.find((player) => player?.role === 'dm');
        if (byRole) return byRole;
    }

    if (normalizedDmId && players.length) {
        const byId = players.find((player) => {
            if (!player) return false;
            const { userId, id, user } = player;
            return (
                idsMatch(userId, normalizedDmId) ||
                idsMatch(id, normalizedDmId) ||
                idsMatch(user?.id, normalizedDmId)
            );
        });
        if (byId) return byId;
    }

    if (typeof game.dm === 'string' && game.dm) return game.dm;
    if (game.dm && typeof game.dm === 'object') {
        return dmSummary ?? normalizedDmId;
    }
    if (game.dm) return game.dm;
    return normalizedDmId;
}

export function describeGameDungeonMaster(game) {
    return describePlayer(resolveGameDungeonMaster(game));
}

export function formatGameUpdated(value) {
    if (!value) return 'recently';
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return 'recently';
    return new Date(timestamp).toLocaleString();
}
