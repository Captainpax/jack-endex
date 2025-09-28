import { Games } from "../api";

/**
 * Dispatch a battle map log entry to the server.
 *
 * @param {string} gameId
 * @param {{ action: string, message?: string, details?: any }} entry
 */
export async function logBattleEvent(gameId, entry) {
    if (!gameId || !entry || typeof entry.action !== "string" || !entry.action.trim()) {
        return null;
    }

    const payload = {
        action: entry.action.trim(),
        ...(typeof entry.message === "string" && entry.message.trim()
            ? { message: entry.message.trim() }
            : {}),
        ...(entry.details !== undefined ? { details: sanitizeDetails(entry.details) } : {}),
    };

    return Games.logBattleEvent(gameId, payload);
}

function sanitizeDetails(details) {
    if (details === null || details === undefined) return undefined;
    if (typeof details === "string" || typeof details === "number" || typeof details === "boolean") {
        return details;
    }
    try {
        return JSON.parse(JSON.stringify(details));
    } catch {
        return undefined;
    }
}

