import { useCallback } from "react";

import { logBattleEvent } from "../utils/battleLogger";

/**
 * Hook that provides a convenient logger for sending battle map diagnostics to the server.
 *
 * @param {string} gameId
 * @returns {(action: string, message?: string, details?: any) => void}
 */
export default function useBattleLogger(gameId) {
    return useCallback(
        (action, message, details) => {
            if (!gameId || !action) return;
            logBattleEvent(gameId, { action, message, details }).catch((err) => {
                // Swallow logging failures so they never impact the UX.
                if (process.env.NODE_ENV !== "production") {
                    console.debug("battle log failed", err);
                }
            });
        },
        [gameId],
    );
}

