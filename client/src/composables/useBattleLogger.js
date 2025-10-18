import { unref } from 'vue';
import { logBattleEvent } from '../utils/battleLogger';

/**
 * Vue composable that returns a stable battle logger function.
 * @param {import('vue').Ref<string>|string|(() => string|null)} gameIdSource
 */
export function useBattleLogger(gameIdSource) {
    const resolveGameId = () => {
        if (typeof gameIdSource === 'function') {
            try {
                return gameIdSource();
            } catch {
                return null;
            }
        }
        return unref(gameIdSource);
    };

    return (action, message, details) => {
        const gameId = resolveGameId();
        if (!gameId || !action) return;
        logBattleEvent(gameId, { action, message, details }).catch((err) => {
            if (import.meta.env.DEV) {
                console.debug('battle log failed', err);
            }
        });
    };
}

export default useBattleLogger;
