import { describe, expect, beforeEach, vi, it } from 'vitest';
import { createMemoryHistory } from 'vue-router';

import { createAppRouter } from '../index';
import { __resetAuthStore } from '../../composables/useAuthStore';
import { Auth } from '../../api';

vi.mock('../../api', () => ({
    Auth: {
        me: vi.fn(),
        login: vi.fn(),
        register: vi.fn(),
        logout: vi.fn(),
    },
}));

describe('router navigation guards', () => {
    beforeEach(() => {
        __resetAuthStore();
        vi.clearAllMocks();
    });

    it('redirects to /login when no session is present', async () => {
        Auth.me.mockResolvedValueOnce(null);
        const router = createAppRouter({ history: createMemoryHistory() });

        await router.push('/');
        await router.isReady();

        expect(router.currentRoute.value.name).toBe('auth');
        expect(router.currentRoute.value.query.redirect).toBe('/');
    });

    it('redirects authenticated users away from the login page', async () => {
        Auth.me.mockResolvedValueOnce({ id: '123', username: 'demo' });
        const router = createAppRouter({ history: createMemoryHistory() });

        await router.push('/login');
        await router.isReady();

        expect(router.currentRoute.value.name).toBe('dashboard');
    });
});
