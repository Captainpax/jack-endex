<template>
    <section class="panel">
        <header class="panel__header">
            <h3 class="panel__title">Server management</h3>
            <div class="panel__actions">
                <button type="button" class="button button--small" @click="refreshActive">Refresh game</button>
                <button type="button" class="button button--small" @click="refreshGames">Refresh campaigns</button>
            </div>
        </header>

        <p v-if="!isAdmin" class="panel__placeholder">
            Administrative tools are limited in this simplified interface.
        </p>

        <div v-else class="panel__content">
            <section class="panel__section">
                <header class="panel__section-header">
                    <div>
                        <h4 class="panel__section-title">Users</h4>
                        <p class="panel__section-subtitle">
                            {{ users.length }} total · Page {{ usersPage }} of {{ Math.max(usersTotalPages, 1) }}
                        </p>
                    </div>
                    <div class="panel__section-actions">
                        <button
                            type="button"
                            class="button button--small"
                            :disabled="usersLoading"
                            @click="loadUsers"
                        >
                            {{ usersLoading ? 'Refreshing…' : 'Refresh users' }}
                        </button>
                    </div>
                </header>
                <p v-if="usersError" class="panel__error">{{ usersError }}</p>
                <ul v-else-if="paginatedUsers.length" class="entity-list">
                    <li v-for="user in paginatedUsers" :key="user.id" class="entity-list__item">
                        <div class="entity-list__meta">
                            <p class="entity-list__title">{{ user.username || user.email || user.id }}</p>
                            <p class="entity-list__subtitle">
                                ID {{ user.id }}<span v-if="user.email"> · {{ user.email }}</span>
                                <span v-if="user.banned"> · Banned</span>
                            </p>
                        </div>
                        <button
                            type="button"
                            class="button button--danger button--small"
                            :disabled="userBusyIds.has(user.id)"
                            @click="() => handleRemoveUser(user)"
                        >
                            {{ userBusyIds.has(user.id) ? 'Removing…' : 'Remove' }}
                        </button>
                    </li>
                </ul>
                <p v-else-if="!usersLoading" class="panel__placeholder">No users found.</p>
                <footer class="panel__pagination" v-if="usersTotalPages > 1">
                    <button
                        type="button"
                        class="button button--small"
                        :disabled="usersPage <= 1"
                        @click="usersPage--"
                    >
                        Previous
                    </button>
                    <button
                        type="button"
                        class="button button--small"
                        :disabled="usersPage >= usersTotalPages"
                        @click="usersPage++"
                    >
                        Next
                    </button>
                </footer>
            </section>

            <section class="panel__section">
                <header class="panel__section-header">
                    <div>
                        <h4 class="panel__section-title">Games</h4>
                        <p class="panel__section-subtitle">
                            {{ games.length }} total · Page {{ gamesPage }} of {{ Math.max(gamesTotalPages, 1) }}
                        </p>
                    </div>
                    <div class="panel__section-actions">
                        <button
                            type="button"
                            class="button button--small"
                            :disabled="gamesLoading"
                            @click="loadGames"
                        >
                            {{ gamesLoading ? 'Refreshing…' : 'Refresh games' }}
                        </button>
                    </div>
                </header>
                <p v-if="gamesError" class="panel__error">{{ gamesError }}</p>
                <ul v-else-if="paginatedGames.length" class="entity-list">
                    <li v-for="game in paginatedGames" :key="game.id" class="entity-list__item">
                        <div class="entity-list__meta">
                            <p class="entity-list__title">{{ game.name || `Campaign ${game.id}` }}</p>
                            <p class="entity-list__subtitle">
                                DM · {{ game.dmUsername || game.dmId || 'Unassigned' }} · Players {{ game.players?.length || 0 }}
                            </p>
                        </div>
                        <button
                            type="button"
                            class="button button--danger button--small"
                            :disabled="gameBusyIds.has(game.id)"
                            @click="() => handleDeleteGame(game)"
                        >
                            {{ gameBusyIds.has(game.id) ? 'Deleting…' : 'Delete' }}
                        </button>
                    </li>
                </ul>
                <p v-else-if="!gamesLoading" class="panel__placeholder">No games found.</p>
                <footer class="panel__pagination" v-if="gamesTotalPages > 1">
                    <button
                        type="button"
                        class="button button--small"
                        :disabled="gamesPage <= 1"
                        @click="gamesPage--"
                    >
                        Previous
                    </button>
                    <button
                        type="button"
                        class="button button--small"
                        :disabled="gamesPage >= gamesTotalPages"
                        @click="gamesPage++"
                    >
                        Next
                    </button>
                </footer>
            </section>

            <section class="panel__section panel__section--stacked">
                <header class="panel__section-header">
                    <div>
                        <h4 class="panel__section-title">Codex</h4>
                        <p class="panel__section-subtitle">Synchronise demon and item data</p>
                    </div>
                    <div class="panel__section-actions">
                        <button
                            type="button"
                            class="button button--small"
                            :disabled="demonsLoading"
                            @click="loadDemons"
                        >
                            {{ demonsLoading ? 'Refreshing…' : 'Refresh demons' }}
                        </button>
                        <button
                            type="button"
                            class="button button--small"
                            :disabled="itemsLoading"
                            @click="loadItems"
                        >
                            {{ itemsLoading ? 'Refreshing…' : 'Refresh items' }}
                        </button>
                    </div>
                </header>
                <div class="codex">
                    <div class="codex__pane">
                        <h5>Demon codex</h5>
                        <p v-if="demonsError" class="panel__error">{{ demonsError }}</p>
                        <p v-else-if="demonsLoading" class="panel__placeholder">Loading demons…</p>
                        <p v-else class="codex__summary">{{ demons.length }} entries</p>
                        <button
                            type="button"
                            class="button button--danger button--small"
                            :disabled="demonsSyncing"
                            @click="handleSyncDemons"
                        >
                            {{ demonsSyncing ? 'Syncing…' : 'Sync demon codex' }}
                        </button>
                    </div>
                    <div class="codex__pane">
                        <h5>Item library</h5>
                        <p v-if="itemsError" class="panel__error">{{ itemsError }}</p>
                        <p v-else-if="itemsLoading" class="panel__placeholder">Loading items…</p>
                        <p v-else class="codex__summary">{{ items.length }} entries</p>
                        <button
                            type="button"
                            class="button button--danger button--small"
                            :disabled="itemsSyncing"
                            @click="handleSyncItems"
                        >
                            {{ itemsSyncing ? 'Syncing…' : 'Sync item codex' }}
                        </button>
                    </div>
                </div>
            </section>

            <section class="panel__section panel__section--stacked">
                <header class="panel__section-header">
                    <div>
                        <h4 class="panel__section-title">Master Bot</h4>
                        <p class="panel__section-subtitle">Discord integration status</p>
                    </div>
                    <div class="panel__section-actions">
                        <button
                            type="button"
                            class="button button--small"
                            :disabled="masterBotLoading"
                            @click="loadMasterBot"
                        >
                            {{ masterBotLoading ? 'Refreshing…' : 'Refresh settings' }}
                        </button>
                    </div>
                </header>
                <p v-if="masterBotError" class="panel__error">{{ masterBotError }}</p>
                <dl v-else-if="masterBot" class="masterbot">
                    <div class="masterbot__row">
                        <dt>Status</dt>
                        <dd>{{ masterBot.enabled ? 'Enabled' : 'Disabled' }}</dd>
                    </div>
                    <div class="masterbot__row" v-if="masterBot.guildId">
                        <dt>Guild</dt>
                        <dd>{{ masterBot.guildId }}</dd>
                    </div>
                    <div class="masterbot__row" v-if="masterBot.channelId">
                        <dt>Channel</dt>
                        <dd>{{ masterBot.channelId }}</dd>
                    </div>
                    <div class="masterbot__row" v-if="masterBot.webhookUrl">
                        <dt>Webhook</dt>
                        <dd class="masterbot__mono">{{ masterBot.webhookUrl }}</dd>
                    </div>
                </dl>
                <p v-else-if="!masterBotLoading" class="panel__placeholder">No configuration found.</p>
            </section>
        </div>
    </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

import { ServerAdmin } from '../api';
import { useAuthStore } from '../composables/useAuthStore';

const PAGE_SIZE = 10;

const props = defineProps({
    activeGameId: { type: String, default: null },
    onRefreshActiveGame: { type: Function, default: null },
    onRefreshGames: { type: Function, default: null },
});

const auth = useAuthStore();
const me = computed(() => auth.user.value);
const isAdmin = computed(() => Boolean(me.value?.isAdmin));

const users = ref([]);
const usersPage = ref(1);
const usersLoading = ref(false);
const usersError = ref('');
const userBusyIds = ref(new Set());

const games = ref([]);
const gamesPage = ref(1);
const gamesLoading = ref(false);
const gamesError = ref('');
const gameBusyIds = ref(new Set());

const demons = ref([]);
const demonsLoading = ref(false);
const demonsError = ref('');
const demonsSyncing = ref(false);

const items = ref([]);
const itemsLoading = ref(false);
const itemsError = ref('');
const itemsSyncing = ref(false);

const masterBot = ref(null);
const masterBotLoading = ref(false);
const masterBotError = ref('');

const usersTotalPages = computed(() => (users.value.length ? Math.ceil(users.value.length / PAGE_SIZE) : 0));
const gamesTotalPages = computed(() => (games.value.length ? Math.ceil(games.value.length / PAGE_SIZE) : 0));

const paginatedUsers = computed(() => {
    if (!users.value.length) return [];
    const start = (usersPage.value - 1) * PAGE_SIZE;
    return users.value.slice(start, start + PAGE_SIZE);
});

const paginatedGames = computed(() => {
    if (!games.value.length) return [];
    const start = (gamesPage.value - 1) * PAGE_SIZE;
    return games.value.slice(start, start + PAGE_SIZE);
});

watch(
    () => [usersTotalPages.value, users.value.length],
    ([total]) => {
        if (!total) {
            usersPage.value = 1;
        } else if (usersPage.value > total) {
            usersPage.value = total;
        }
    },
);

watch(
    () => [gamesTotalPages.value, games.value.length],
    ([total]) => {
        if (!total) {
            gamesPage.value = 1;
        } else if (gamesPage.value > total) {
            gamesPage.value = total;
        }
    },
);

watch(
    () => isAdmin.value,
    (allowed) => {
        if (allowed) {
            bootstrapAdmin();
        } else {
            resetState();
        }
    },
    { immediate: true },
);

function resetState() {
    users.value = [];
    usersPage.value = 1;
    usersError.value = '';
    userBusyIds.value = new Set();
    games.value = [];
    gamesPage.value = 1;
    gamesError.value = '';
    gameBusyIds.value = new Set();
    demons.value = [];
    demonsError.value = '';
    items.value = [];
    itemsError.value = '';
    masterBot.value = null;
    masterBotError.value = '';
}

function refreshActive() {
    props.onRefreshActiveGame?.(props.activeGameId);
}

function refreshGames() {
    props.onRefreshGames?.();
}

async function bootstrapAdmin() {
    await Promise.all([loadUsers(), loadGames(), loadDemons(), loadItems(), loadMasterBot()]);
}

async function loadUsers() {
    if (!isAdmin.value) return;
    usersLoading.value = true;
    usersError.value = '';
    try {
        const result = await ServerAdmin.users.list();
        users.value = Array.isArray(result) ? result : [];
        usersPage.value = 1;
    } catch (error) {
        console.error('[admin] Failed to load users', error);
        usersError.value = 'Failed to load users.';
    } finally {
        usersLoading.value = false;
    }
}

async function handleRemoveUser(user) {
    if (!user?.id) return;
    const confirmed = window.confirm(`Remove ${user.username || user.email || user.id}? This cannot be undone.`);
    if (!confirmed) return;
    const nextBusy = new Set(userBusyIds.value);
    nextBusy.add(user.id);
    userBusyIds.value = nextBusy;
    try {
        await ServerAdmin.users.delete(user.id);
        await loadUsers();
        props.onRefreshGames?.();
        if (props.activeGameId) {
            props.onRefreshActiveGame?.(props.activeGameId);
        }
    } catch (error) {
        console.error('[admin] Failed to remove user', error);
        window.alert('Failed to remove user.');
    } finally {
        const cleared = new Set(userBusyIds.value);
        cleared.delete(user.id);
        userBusyIds.value = cleared;
    }
}

async function loadGames() {
    if (!isAdmin.value) return;
    gamesLoading.value = true;
    gamesError.value = '';
    try {
        const result = await ServerAdmin.games.list();
        games.value = Array.isArray(result) ? result : [];
        gamesPage.value = 1;
    } catch (error) {
        console.error('[admin] Failed to load games', error);
        gamesError.value = 'Failed to load games.';
    } finally {
        gamesLoading.value = false;
    }
}

async function handleDeleteGame(game) {
    if (!game?.id) return;
    const confirmed = window.confirm(`Delete ${game.name || game.id}? This cannot be undone.`);
    if (!confirmed) return;
    const nextBusy = new Set(gameBusyIds.value);
    nextBusy.add(game.id);
    gameBusyIds.value = nextBusy;
    try {
        await ServerAdmin.games.delete(game.id);
        await loadGames();
        props.onRefreshGames?.();
        if (props.activeGameId === game.id) {
            props.onRefreshActiveGame?.(props.activeGameId);
        }
    } catch (error) {
        console.error('[admin] Failed to delete game', error);
        window.alert('Failed to delete game.');
    } finally {
        const cleared = new Set(gameBusyIds.value);
        cleared.delete(game.id);
        gameBusyIds.value = cleared;
    }
}

async function loadDemons() {
    if (!isAdmin.value) return;
    demonsLoading.value = true;
    demonsError.value = '';
    try {
        const result = await ServerAdmin.demons.list();
        demons.value = Array.isArray(result) ? result : [];
    } catch (error) {
        console.error('[admin] Failed to load demons', error);
        demonsError.value = 'Failed to load demon codex.';
    } finally {
        demonsLoading.value = false;
    }
}

async function handleSyncDemons() {
    if (demonsSyncing.value) return;
    const confirmed = window.confirm('Sync demon codex to the database?');
    if (!confirmed) return;
    demonsSyncing.value = true;
    try {
        await ServerAdmin.demons.sync();
        await loadDemons();
    } catch (error) {
        console.error('[admin] Failed to sync demon codex', error);
        window.alert('Failed to sync demon codex.');
    } finally {
        demonsSyncing.value = false;
    }
}

async function loadItems() {
    if (!isAdmin.value) return;
    itemsLoading.value = true;
    itemsError.value = '';
    try {
        const result = await ServerAdmin.items.list();
        items.value = Array.isArray(result) ? result : [];
    } catch (error) {
        console.error('[admin] Failed to load items', error);
        itemsError.value = 'Failed to load item codex.';
    } finally {
        itemsLoading.value = false;
    }
}

async function handleSyncItems() {
    if (itemsSyncing.value) return;
    const confirmed = window.confirm('Sync item codex to the database?');
    if (!confirmed) return;
    itemsSyncing.value = true;
    try {
        await ServerAdmin.items.sync();
        await loadItems();
    } catch (error) {
        console.error('[admin] Failed to sync item codex', error);
        window.alert('Failed to sync item codex.');
    } finally {
        itemsSyncing.value = false;
    }
}

async function loadMasterBot() {
    if (!isAdmin.value) return;
    masterBotLoading.value = true;
    masterBotError.value = '';
    try {
        const result = await ServerAdmin.masterBot.get();
        masterBot.value = result || null;
    } catch (error) {
        console.error('[admin] Failed to load master bot settings', error);
        masterBotError.value = 'Failed to load master bot settings.';
    } finally {
        masterBotLoading.value = false;
    }
}
</script>

<style scoped>
.panel {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.panel__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.panel__title {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
}

.panel__actions {
    display: flex;
    gap: 0.5rem;
}

.panel__placeholder {
    color: rgba(255, 255, 255, 0.65);
}

.panel__content {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

.panel__section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    background: rgba(255, 255, 255, 0.05);
    padding: 1rem;
    border-radius: 0.75rem;
}

.panel__section--stacked {
    gap: 0.75rem;
}

.panel__section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
}

.panel__section-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
}

.panel__section-subtitle {
    margin: 0.25rem 0 0;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.6);
}

.panel__section-actions {
    display: flex;
    gap: 0.5rem;
}

.panel__error {
    margin: 0;
    color: #ff7b7b;
}

.panel__pagination {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}

.entity-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.entity-list__item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
}

.entity-list__meta {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.entity-list__title {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
}

.entity-list__subtitle {
    margin: 0;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.65);
}

.codex {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
}

.codex__pane {
    flex: 1 1 220px;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem;
    border-radius: 0.75rem;
    background: rgba(255, 255, 255, 0.04);
}

.codex__summary {
    margin: 0;
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.7);
}

.masterbot {
    display: grid;
    gap: 0.5rem;
}

.masterbot__row {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.85rem;
}

.masterbot__row dt {
    margin: 0;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.8);
}

.masterbot__row dd {
    margin: 0;
    text-align: right;
    color: rgba(255, 255, 255, 0.7);
}

.masterbot__mono {
    font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    word-break: break-all;
}

.button {
    border: none;
    border-radius: 999px;
    padding: 0.45rem 0.9rem;
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;
}

.button--small {
    font-size: 0.8rem;
}

.button--danger {
    background: rgba(255, 82, 82, 0.15);
    color: #ff8a80;
}

.button:disabled {
    opacity: 0.55;
    cursor: default;
}
</style>
