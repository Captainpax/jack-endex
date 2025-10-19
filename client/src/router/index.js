import { createRouter, createWebHistory, createMemoryHistory } from 'vue-router';

import DashboardView from '../views/DashboardView.vue';
import AuthView from '../views/AuthView.vue';
import { useAuthStore } from '../composables/useAuthStore';

export const routes = [
    {
        path: '/',
        name: 'dashboard',
        component: DashboardView,
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
