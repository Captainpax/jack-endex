import { computed, reactive } from 'vue';

import { Auth } from '../api';
import { normalizeId } from '../utils/ids';

const state = reactive({
    user: null,
    sessionChecked: false,
});

function normalizeUser(user) {
    if (!user) return null;
    const normalizedId = normalizeId(user.id) ?? user.id ?? null;
    return { ...user, id: normalizedId };
}

export function useAuthStore() {
    async function fetchSession({ force = false } = {}) {
        if (force) {
            state.sessionChecked = false;
        }

        if (state.sessionChecked && !force) {
            return state.user;
        }

        try {
            const session = await Auth.me();
            state.user = normalizeUser(session) ?? null;
        } catch (error) {
            console.error(error);
            state.user = null;
        } finally {
            state.sessionChecked = true;
        }

        return state.user;
    }

    async function logout() {
        try {
            await Auth.logout();
        } catch (error) {
            console.error(error);
        } finally {
            state.user = null;
            state.sessionChecked = false;
        }
    }

    function setUser(user) {
        state.user = normalizeUser(user);
    }

    return {
        user: computed(() => state.user),
        sessionChecked: computed(() => state.sessionChecked),
        fetchSession,
        logout,
        setUser,
    };
}

export function __resetAuthStore() {
    state.user = null;
    state.sessionChecked = false;
}
