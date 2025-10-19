export function presentDungeonMaster(game) {
    if (!game || typeof game !== 'object') return null;

    const dmId = readUserId(game.dmId);
    const players = Array.isArray(game.players) ? game.players : [];

    const roleMatch = players.find((player) => isDungeonMasterRole(player));
    const idMatch = dmId ? players.find((player) => matchesPlayerId(player, dmId)) : null;
    const candidate = roleMatch || idMatch || (typeof game.dm === 'object' && game.dm);

    const summary = normalizeDungeonMasterSummary(candidate, dmId);
    if (summary) return summary;

    if (typeof game.dm === 'string' && game.dm.trim()) {
        const username = game.dm.trim();
        return {
            userId: dmId,
            username,
            displayName: username,
            role: 'dm',
        };
    }

    if (dmId) {
        return {
            userId: dmId,
            username: null,
            displayName: null,
            role: 'dm',
        };
    }

    return null;
}

function isDungeonMasterRole(player) {
    if (!player || typeof player !== 'object') return false;
    const role = typeof player.role === 'string' ? player.role.trim().toLowerCase() : '';
    return role === 'dm' || role === 'dungeon master';
}

function matchesPlayerId(player, targetId) {
    if (!player || typeof player !== 'object' || !targetId) return false;
    return (
        readUserId(player.userId) === targetId
        || readUserId(player.id) === targetId
        || readUserId(player.user?.id) === targetId
    );
}

function normalizeDungeonMasterSummary(candidate, fallbackId) {
    if (!candidate || typeof candidate !== 'object') return null;
    const userId = readUserId(candidate.userId)
        || readUserId(candidate.id)
        || readUserId(candidate.user?.id)
        || fallbackId
        || null;
    const username = readString(candidate.username) || readString(candidate.user?.username) || null;
    const displayName = readString(candidate.displayName)
        || readString(candidate.user?.displayName)
        || username
        || null;
    const role = readString(candidate.role) || 'dm';

    const summary = {
        userId,
        username,
        displayName,
        role: role.toLowerCase() === 'dm' ? 'dm' : role,
    };

    if (typeof candidate.online === 'boolean') {
        summary.online = candidate.online;
    }

    return summary;
}

function readUserId(value) {
    if (!value) return null;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return null;
}

function readString(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}
