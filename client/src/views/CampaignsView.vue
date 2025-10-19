<template>
    <div class="campaigns-shell">
        <LoadingBar />
        <header class="campaigns-shell__header" v-if="me">
            <h1 class="campaigns-shell__title">Jack Endex Control Center</h1>
            <p class="campaigns-shell__subtitle">Signed in as {{ me.username || me.email || me.id }}</p>
        </header>
        <main class="campaigns-shell__body" v-if="!loading">
            <section class="campaigns-shell__panel">
                <header class="campaigns-shell__panel-header">
                    <h2 class="campaigns-shell__panel-title">Choose a campaign</h2>
                    <button type="button" class="button" @click="refreshGames" :disabled="refreshing">
                        {{ refreshing ? 'Refreshing…' : 'Refresh list' }}
                    </button>
                </header>
                <p v-if="error" class="campaigns-shell__error">{{ error }}</p>
                <p v-else-if="!games.length" class="campaigns-shell__placeholder">
                    No campaigns available yet.
                </p>
                <ul v-else class="game-list">
                    <li
                        v-for="game in games"
                        :key="game.id"
                        :class="['game-list__item', { 'is-active': activeGameId === game.id }]"
                    >
                        <button
                            type="button"
                            class="game-list__button"
                            @click="() => handleSelect(game.id)"
                            :disabled="selecting === game.id"
                        >
                            <span class="game-list__name">{{ game.name || `Campaign ${game.id}` }}</span>
                            <span class="game-list__meta">
                                DM · {{ describeGameDungeonMaster(game) }} · Players {{ game.players?.length || 0 }}
                            </span>
                        </button>
                    </li>
                </ul>
            </section>
            <section class="campaigns-shell__actions">
                <button type="button" class="button button--muted" @click="goToDashboard" :disabled="!activeGameId">
                    Open dashboard
                </button>
                <button type="button" class="button button--muted" @click="logout" :disabled="logoutBusy">
                    {{ logoutBusy ? 'Signing out…' : 'Sign out' }}
                </button>
            </section>
        </main>
        <p v-else class="campaigns-shell__loading">Loading campaigns…</p>
    </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import LoadingBar from '../components/LoadingBar.vue';
import { useAuthStore } from '../composables/useAuthStore';
import { useGamesStore } from '../composables/useGamesStore';
import { describeGameDungeonMaster } from '../utils/gameDescriptions';

const router = useRouter();
const auth = useAuthStore();
const gamesStore = useGamesStore();

const loading = ref(true);
const selecting = ref('');
const logoutBusy = ref(false);
const error = ref('');

const me = computed(() => auth.user.value);
const games = computed(() => gamesStore.games.value);
const activeGameId = computed(() => gamesStore.activeGameId.value);
const refreshing = computed(
    () => gamesStore.loadingList.value || gamesStore.loadingActiveGame.value || selecting.value !== ''
);

watch(
    () => gamesStore.error.value,
    (message) => {
        if (message) {
            error.value = message;
        }
    }
);

onMounted(() => {
    initialize();
});

async function initialize() {
    try {
        loading.value = true;
        if (!me.value) {
            await auth.fetchSession();
        }

        if (!me.value) {
            await router.replace({ name: 'auth', query: { redirect: router.currentRoute.value.fullPath } });
            return;
        }

        await gamesStore.initialize({ force: true });
        error.value = gamesStore.error.value || '';
    } catch (err) {
        console.error(err);
        error.value = err?.message || 'Failed to load campaigns.';
    } finally {
        loading.value = false;
    }
}

async function refreshGames() {
    try {
        await gamesStore.fetchGames();
        error.value = gamesStore.error.value || '';
    } catch (err) {
        console.error(err);
        error.value = err?.message || 'Failed to refresh campaigns.';
    }
}

async function handleSelect(id) {
    if (!id || selecting.value) return;
    selecting.value = id;
    try {
        await gamesStore.selectGame(id);
        error.value = gamesStore.error.value || '';
        const redirect = router.currentRoute.value.query?.redirect;
        if (typeof redirect === 'string' && redirect) {
            await router.replace(redirect);
        } else {
            await router.replace({ name: 'dashboard' });
        }
    } catch (err) {
        console.error(err);
        error.value = err?.message || 'Failed to load campaign.';
    } finally {
        selecting.value = '';
    }
}

async function goToDashboard() {
    if (!activeGameId.value) return;
    const redirect = router.currentRoute.value.query?.redirect;
    if (typeof redirect === 'string' && redirect) {
        await router.replace(redirect);
    } else {
        await router.replace({ name: 'dashboard' });
    }
}

async function logout() {
    if (!me.value) return;
    try {
        logoutBusy.value = true;
        await auth.logout();
        gamesStore.reset();
        await router.replace({ name: 'auth' });
    } catch (err) {
        console.error(err);
        error.value = err?.message || 'Failed to log out.';
    } finally {
        logoutBusy.value = false;
    }
}
</script>

<style scoped>
.campaigns-shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: radial-gradient(circle at top, rgba(32, 45, 72, 0.9), #0a1224 70%);
    color: #f2f6ff;
    padding: 2rem 3vw 3rem;
    box-sizing: border-box;
}

.campaigns-shell__header {
    max-width: 960px;
    margin: 0 auto 2rem;
    text-align: center;
}

.campaigns-shell__title {
    margin: 0;
    font-size: 2.5rem;
    font-weight: 700;
}

.campaigns-shell__subtitle {
    margin: 0.5rem 0 0;
    font-size: 1rem;
    color: rgba(242, 246, 255, 0.7);
}

.campaigns-shell__body {
    max-width: 960px;
    width: 100%;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

.campaigns-shell__panel {
    background: rgba(12, 15, 30, 0.75);
    border-radius: 1rem;
    padding: 1.5rem;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
}

.campaigns-shell__panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.25rem;
}

.campaigns-shell__panel-title {
    margin: 0;
    font-size: 1.5rem;
}

.campaigns-shell__error {
    margin: 0 0 1rem;
    padding: 0.75rem 1rem;
    border-radius: 0.75rem;
    background: rgba(255, 92, 92, 0.15);
    color: #ff9d9d;
}

.campaigns-shell__placeholder {
    margin: 0;
    color: rgba(242, 246, 255, 0.7);
}

.campaigns-shell__actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    justify-content: flex-end;
}

.campaigns-shell__loading {
    text-align: center;
    color: rgba(242, 246, 255, 0.8);
    margin: 4rem 0;
}

.game-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.game-list__item {
    border-radius: 0.85rem;
    overflow: hidden;
    background: rgba(21, 29, 49, 0.6);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.game-list__button {
    width: 100%;
    background: none;
    border: none;
    color: inherit;
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.35rem;
    cursor: pointer;
    text-align: left;
}

.game-list__item.is-active,
.game-list__button:hover,
.game-list__button:focus-visible {
    transform: translateY(-1px);
    box-shadow: 0 12px 30px rgba(80, 120, 255, 0.35);
    background: linear-gradient(135deg, rgba(90, 173, 255, 0.35), rgba(130, 248, 255, 0.35));
}

.game-list__name {
    font-size: 1.1rem;
    font-weight: 600;
}

.game-list__meta {
    font-size: 0.85rem;
    color: rgba(242, 246, 255, 0.75);
}

.button[disabled] {
    opacity: 0.6;
    cursor: not-allowed;
}
</style>
