import { computed, reactive } from 'vue';

import { Games } from '../api';
import { idsMatch, normalizeId } from '../utils/ids';

const STORAGE_KEY = 'jack-endex:selectedGameId';

function readPersistedGameId() {
    if (typeof window === 'undefined') return null;
    try {
        const value = window.localStorage.getItem(STORAGE_KEY);
        return normalizeId(value);
    } catch (error) {
        console.error(error);
        return null;
    }
}

function persistGameId(id) {
    if (typeof window === 'undefined') return;
    try {
        if (id) {
            window.localStorage.setItem(STORAGE_KEY, id);
        } else {
            window.localStorage.removeItem(STORAGE_KEY);
        }
    } catch (error) {
        console.error(error);
    }
}

function normalizeGame(game) {
    if (!game || typeof game !== 'object') return null;
    const normalizedId = normalizeId(game.id) ?? game.id ?? null;
    const normalizedDmId = normalizeId(game.dmId) ?? game.dmId ?? null;
    return {
        ...game,
        id: normalizedId,
        dmId: normalizedDmId,
    };
}

const state = reactive({
    games: [],
    activeGameId: readPersistedGameId(),
    activeGame: null,
    loadingList: false,
    loadingActiveGame: false,
    initialized: false,
    error: '',
});

function setGames(list) {
    state.games = Array.isArray(list) ? list.filter(Boolean) : [];
}

function clearSelection() {
    state.activeGameId = null;
    state.activeGame = null;
    persistGameId(null);
}

function resetState() {
    setGames([]);
    clearSelection();
    state.loadingList = false;
    state.loadingActiveGame = false;
    state.initialized = false;
    state.error = '';
}

async function fetchGamesInternal() {
    try {
        state.loadingList = true;
        const list = await Games.list();
        const normalized = Array.isArray(list) ? list.map(normalizeGame).filter(Boolean) : [];
        setGames(normalized);
        state.error = '';
        if (state.activeGameId) {
            const match = normalized.find((game) => idsMatch(game.id, state.activeGameId));
            if (!match) {
                clearSelection();
            }
        }
    } catch (error) {
        console.error(error);
        state.error = error?.message || 'Failed to load campaigns.';
        setGames([]);
        throw error;
    } finally {
        state.loadingList = false;
    }
}

async function fetchActiveGameInternal(id) {
    const normalizedId = normalizeId(id) ?? state.activeGameId;
    if (!normalizedId) {
        clearSelection();
        return null;
    }
    try {
        state.loadingActiveGame = true;
        const data = await Games.get(normalizedId);
        const normalized = normalizeGame(data);
        state.activeGame = normalized;
        state.activeGameId = normalized?.id ?? normalizedId;
        persistGameId(state.activeGameId ?? null);
        state.error = '';
        return state.activeGame;
    } catch (error) {
        console.error(error);
        state.error = error?.message || 'Failed to load campaign.';
        clearSelection();
        throw error;
    } finally {
        state.loadingActiveGame = false;
    }
}

export function useGamesStore() {
    async function initialize({ force = false } = {}) {
        if (!state.initialized || force || !state.games.length) {
            try {
                await fetchGamesInternal();
            } catch (error) {
                // ignore here so callers can handle via state.error
            }
        }

        state.initialized = true;

        if (state.activeGameId && !state.activeGame) {
            try {
                await fetchActiveGameInternal(state.activeGameId);
            } catch (error) {
                // handled via state.error
            }
        }
    }

    async function fetchGames() {
        return fetchGamesInternal();
    }

    async function refreshActiveGame() {
        return fetchActiveGameInternal(state.activeGameId);
    }

    async function selectGame(id) {
        const normalizedId = normalizeId(id);
        if (!normalizedId) {
            clearSelection();
            return null;
        }
        state.activeGameId = normalizedId;
        persistGameId(normalizedId);
        return fetchActiveGameInternal(normalizedId);
    }

    function setActiveGame(game) {
        const normalized = normalizeGame(game);
        state.activeGame = normalized;
        state.activeGameId = normalized?.id ?? null;
        persistGameId(state.activeGameId ?? null);
    }

    return {
        games: computed(() => state.games),
        activeGame: computed(() => state.activeGame),
        activeGameId: computed(() => state.activeGameId),
        loadingList: computed(() => state.loadingList),
        loadingActiveGame: computed(() => state.loadingActiveGame),
        error: computed(() => state.error),
        initialized: computed(() => state.initialized),
        initialize,
        fetchGames,
        refreshActiveGame,
        selectGame,
        setActiveGame,
        reset: resetState,
    };
}

export function __resetGamesStore() {
    resetState();
}
