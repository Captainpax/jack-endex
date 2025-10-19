import { createRouter, createWebHistory, createMemoryHistory } from 'vue-router';

import DashboardView from '../views/DashboardView.vue';
import CampaignsView from '../views/CampaignsView.vue';
import AuthView from '../views/AuthView.vue';
import { useAuthStore } from '../composables/useAuthStore';
import { useGamesStore } from '../composables/useGamesStore';

export const routes = [
    {
        path: '/dashboard/:tab?/:sheetSlug?/:sheetSection?',
        alias: '/',
        name: 'dashboard',
        component: DashboardView,
        meta: { requiresAuth: true, requiresActiveGame: true },
    },
    {
        path: '/campaigns',
        name: 'campaigns',
        component: CampaignsView,
        meta: { requiresAuth: true },
    },
    {
        path: '/login',
        name: 'auth',
        component: AuthView,
        meta: { redirectIfAuthed: true },
    },
    {
        path: '/:pathMatch(.*)*',
        redirect: '/',
    },
];

function resolveDefaultHistory() {
    if (typeof window === 'undefined') {
        return createMemoryHistory();
    }
    const base = typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL ? import.meta.env.BASE_URL : '/';
    return createWebHistory(base);
}

export function registerNavigationGuards(router) {
    router.beforeEach(async (to) => {
        const auth = useAuthStore();
        if (!auth.sessionChecked.value) {
            try {
                await auth.fetchSession();
            } catch (error) {
                console.error(error);
            }
        }

        const user = auth.user.value;
        if (to.meta?.requiresAuth && !user) {
            if (to.name !== 'auth') {
                return { name: 'auth', query: { redirect: to.fullPath || to.path } };
            }
            return { name: 'auth' };
        }

        if (to.meta?.redirectIfAuthed && user) {
            return { name: 'dashboard' };
        }

        if (!user) {
            return true;
        }

        const games = useGamesStore();
        if (!games.initialized.value) {
            try {
                await games.initialize();
            } catch (error) {
                console.error(error);
            }
        }

        if (to.meta?.requiresActiveGame) {
            if (!games.activeGameId.value) {
                const redirect = to.fullPath || to.path;
                return { name: 'campaigns', query: redirect ? { redirect } : undefined };
            }

            if (!games.activeGame.value) {
                try {
                    await games.refreshActiveGame();
                } catch (error) {
                    console.error(error);
                }

                if (!games.activeGame.value) {
                    const redirect = to.fullPath || to.path;
                    return { name: 'campaigns', query: redirect ? { redirect } : undefined };
                }
            }
        } else if (to.name !== 'campaigns' && !games.activeGameId.value) {
            const redirect = to.fullPath || to.path;
            return { name: 'campaigns', query: redirect ? { redirect } : undefined };
        }

        return true;
    });
}

export function createAppRouter({ history } = {}) {
    const router = createRouter({
        history: history ?? resolveDefaultHistory(),
        routes,
    });
    registerNavigationGuards(router);
    return router;
}

const router = createAppRouter();

export default router;
