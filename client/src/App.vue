<template>
    <div class="app-shell">
        <LoadingBar />
        <header class="app-shell__header" v-if="me">
            <h1 class="app-shell__title">Jack Endex Control Center</h1>
            <p class="app-shell__subtitle">Signed in as {{ me.username || me.email || me.id }}</p>
        </header>
        <main class="app-shell__body" v-if="!loading">
            <aside class="app-shell__sidebar">
                <NavigationSidebar
                    :items="navigationItems"
                    :active-key="activeTab"
                    @select="handleSelectTab"
                />
                <section class="app-shell__games" v-if="games.length">
                    <h2 class="app-shell__section-title">Campaigns</h2>
                    <ul class="game-list">
                        <li
                            v-for="game in games"
                            :key="game.id"
                            :class="['game-list__item', { 'is-active': activeGameId === game.id }]"
                        >
                            <button type="button" class="game-list__button" @click="() => selectGame(game.id)">
                                <span class="game-list__name">{{ game.name || `Campaign ${game.id}` }}</span>
                                <span class="game-list__meta">
                                    DM · {{ describePlayer(game.dm) }} · Players {{ game.players?.length || 0 }}
                                </span>
                            </button>
                        </li>
                    </ul>
                </section>
                <section class="app-shell__actions">
                    <button type="button" class="button" @click="refreshGames" :disabled="refreshing">
                        {{ refreshing ? 'Refreshing…' : 'Refresh games' }}
                    </button>
                    <button type="button" class="button button--muted" @click="logout" :disabled="logoutBusy">
                        {{ logoutBusy ? 'Signing out…' : 'Sign out' }}
                    </button>
                </section>
            </aside>
            <section class="app-shell__content" v-if="activeGame">
                <header class="app-shell__content-header">
                    <h2>{{ activeGame.name }}</h2>
                    <p class="app-shell__content-meta">
                        DM · {{ describePlayer(activeGame.dm) }} — Updated {{ formatUpdated(activeGame.updatedAt) }}
                    </p>
                </header>
                <component :is="activeComponent" v-bind="activeComponentProps" />
            </section>
            <section class="app-shell__empty" v-else>
                <p v-if="error" class="app-shell__error">{{ error }}</p>
                <p v-else class="app-shell__placeholder">Select a campaign to begin.</p>
            </section>
        </main>
        <p v-else class="app-shell__loading">Loading session…</p>
    </div>
</template>

<script setup>
import { computed, onMounted, provide, ref, unref, watch } from 'vue';

import NavigationSidebar from './components/NavigationSidebar.vue';
import LoadingBar from './components/LoadingBar.vue';
import MapTab from './components/battleMap/MapTab.vue';
import ItemsTab from './components/ItemsTab.vue';
import GearTab from './components/GearTab.vue';
import WorldSkillsTab from './components/WorldSkillsTab.vue';
import DemonTab from './components/DemonTab.vue';
import ServerManagementTab from './components/ServerManagementTab.vue';

import { Auth, Games, Help, StoryLogs } from './api';
import { buildNavigation } from './constants/navigation';
import { idsMatch, normalizeId } from './utils/ids';
import { realtimeSymbol, useRealtimeConnection } from './composables/useRealtimeConnection';
import { useBattleLogger } from './composables/useBattleLogger';

const SUPPORTED_TAB_KEYS = new Set([
    'overview',
    'map',
    'items',
    'gear',
    'worldSkills',
    'demons',
    'storyLogs',
    'help',
    'serverManagement',
]);

const SERVER_ADMIN_USERNAMES = new Set(['captainpax', 'amzyoshio']);

const loading = ref(true);
const refreshing = ref(false);
const logoutBusy = ref(false);
const me = ref(null);
const games = ref([]);
const activeGameId = ref(null);
const activeGame = ref(null);
const activeTab = ref('overview');
const storyLogSnapshot = ref(null);
const helpDocs = ref(null);
const error = ref('');

const realtime = useRealtimeConnection({ gameId: activeGameId });
provide(realtimeSymbol, realtime);

const battleLogger = useBattleLogger(activeGameId);

const navigationItems = computed(() => {
    const user = me.value;
    const game = activeGame.value;
    if (!user || !game) return [];
    const isDM = idsMatch(game.dmId, user.id);
    const role = isDM ? 'dm' : 'player';
    const isAdmin = isServerAdminClient(user);
    return buildNavigation({ role, isServerAdmin: isAdmin }).filter((item) =>
        SUPPORTED_TAB_KEYS.has(item.key)
    );
});

const activeComponent = computed(() => {
    switch (activeTab.value) {
        case 'map':
            return MapTab;
        case 'items':
            return ItemsTab;
        case 'gear':
            return GearTab;
        case 'worldSkills':
            return WorldSkillsTab;
        case 'demons':
            return DemonTab;
        case 'storyLogs':
            return StoryLogsPanel;
        case 'help':
            return HelpPanel;
        case 'serverManagement':
            return ServerManagementTab;
        case 'overview':
        default:
            return OverviewPanel;
    }
});

const activeComponentProps = computed(() => {
    const game = activeGame.value;
    if (!game) return {};
    switch (activeComponent.value) {
        case MapTab:
            return { game, me: me.value, logger: battleLogger, realtime };
        case ItemsTab:
            return { game, me: me.value, realtime, onUpdate: () => fetchGame(game.id) };
        case GearTab:
            return { game, me: me.value };
        case WorldSkillsTab:
            return { game, me: me.value };
        case DemonTab:
            return { game, me: me.value };
        case StoryLogsPanel:
            return { snapshot: storyLogSnapshot.value, onRefresh: fetchStoryLog };
        case HelpPanel:
            return { docs: helpDocs.value, onRefresh: fetchHelpDocs };
        case ServerManagementTab:
            return {
                activeGameId: game.id,
                onRefreshGames: refreshGames,
                onRefreshActiveGame: () => fetchGame(game.id),
            };
        default:
            return { game, me: me.value };
    }
});

function isServerAdminClient(user) {
    if (!user) return false;
    if (user.isAdmin) return true;
    const username = typeof user.username === 'string' ? user.username.trim().toLowerCase() : '';
    return username ? SERVER_ADMIN_USERNAMES.has(username) : false;
}

function describePlayer(player) {
    if (!player) return 'Unknown';
    if (typeof player === 'string') return player;
    if (player.character?.name) return player.character.name;
    if (player.username) return player.username;
    if (player.displayName) return player.displayName;
    if (player.userId) return player.userId;
    return 'Unknown';
}

function formatUpdated(value) {
    if (!value) return 'recently';
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return 'recently';
    return new Date(timestamp).toLocaleString();
}

function handleSelectTab(key) {
    if (!SUPPORTED_TAB_KEYS.has(key)) return;
    activeTab.value = key;
    if (key === 'storyLogs') {
        fetchStoryLog();
    } else if (key === 'help') {
        fetchHelpDocs();
    }
}

function selectGame(id) {
    const normalized = normalizeId(id);
    if (!normalized || activeGameId.value === normalized) return;
    activeGameId.value = normalized;
}

async function loadSession() {
    try {
        const session = await Auth.me();
        me.value = session ? { ...session, id: normalizeId(session.id) } : null;
        if (session) {
            await refreshGames();
        }
    } catch (err) {
        console.error(err);
        error.value = err?.message || 'Failed to load session information.';
    } finally {
        loading.value = false;
    }
}

async function refreshGames() {
    if (!me.value) return;
    try {
        refreshing.value = true;
        const list = await Games.list();
        error.value = '';
        games.value = Array.isArray(list)
            ? list.map((game) => ({
                  ...game,
                  id: normalizeId(game.id) ?? game.id,
                  dmId: normalizeId(game.dmId) ?? game.dmId,
              }))
            : [];
        if (!activeGameId.value && games.value.length > 0) {
            activeGameId.value = games.value[0].id;
        } else if (activeGameId.value) {
            const match = games.value.find((game) => idsMatch(game.id, activeGameId.value));
            if (!match && games.value.length > 0) {
                activeGameId.value = games.value[0].id;
            }
        }
    } catch (err) {
        console.error(err);
        error.value = err?.message || 'Failed to refresh campaigns.';
    } finally {
        refreshing.value = false;
    }
}

async function fetchGame(id) {
    if (!id) {
        activeGame.value = null;
        return;
    }
    try {
        const data = await Games.get(id);
        error.value = '';
        activeGame.value = data ? { ...data, id: normalizeId(data.id) ?? data.id } : null;
        if (activeTab.value === 'storyLogs') {
            await fetchStoryLog();
        }
        if (activeTab.value === 'help') {
            await fetchHelpDocs();
        }
    } catch (err) {
        console.error(err);
        error.value = err?.message || 'Failed to load campaign.';
    }
}

async function fetchStoryLog() {
    const game = activeGame.value;
    if (!game?.id) return;
    try {
        const snapshot = await StoryLogs.fetch(game.id);
        storyLogSnapshot.value = snapshot || null;
        error.value = '';
    } catch (err) {
        console.error(err);
        error.value = err?.message || 'Failed to load story log.';
    }
}

async function fetchHelpDocs() {
    try {
        const docs = await Help.docs();
        helpDocs.value = docs || null;
        error.value = '';
    } catch (err) {
        console.error(err);
        error.value = err?.message || 'Failed to load help content.';
    }
}

async function logout() {
    if (!me.value) return;
    try {
        logoutBusy.value = true;
        await Auth.logout();
        if (typeof window !== 'undefined') {
            window.location.reload();
        }
    } catch (err) {
        console.error(err);
        error.value = err?.message || 'Failed to log out.';
    } finally {
        logoutBusy.value = false;
    }
}

watch(activeGameId, (id) => {
    if (!id) {
        activeGame.value = null;
        return;
    }
    fetchGame(id);
});

onMounted(() => {
    loadSession();
});

const OverviewPanel = {
    name: 'OverviewPanel',
    props: {
        game: { type: Object, required: true },
        me: { type: Object, default: null },
    },
    setup(props) {
        const partyCount = computed(() => (Array.isArray(props.game.players) ? props.game.players.length : 0));
        const demonCount = computed(() => (Array.isArray(props.game.demons) ? props.game.demons.length : 0));
        const musicState = computed(() => unref(realtime.musicState));
        return { partyCount, demonCount, musicState, describePlayer };
    },
    template: `
        <section class="panel">
            <h3 class="panel__title">Campaign overview</h3>
            <div class="panel__grid">
                <div class="panel__stat">
                    <span class="panel__stat-label">Players</span>
                    <span class="panel__stat-value">{{ partyCount }}</span>
                </div>
                <div class="panel__stat">
                    <span class="panel__stat-label">Demons</span>
                    <span class="panel__stat-value">{{ demonCount }}</span>
                </div>
                <div class="panel__stat">
                    <span class="panel__stat-label">Music</span>
                    <span class="panel__stat-value">{{ musicState?.title || 'No track' }}</span>
                </div>
            </div>
            <div class="panel__section" v-if="game.players?.length">
                <h4 class="panel__section-title">Party roster</h4>
                <ul class="panel__list">
                    <li v-for="player in game.players" :key="player.userId" class="panel__list-item">
                        {{ describePlayer(player) }}
                    </li>
                </ul>
            </div>
        </section>
    `,
};

const StoryLogsPanel = {
    name: 'StoryLogsPanel',
    props: {
        snapshot: { type: [Array, Object, String], default: null },
        onRefresh: { type: Function, default: null },
    },
    setup(props) {
        const entries = computed(() => {
            const snap = props.snapshot;
            if (!snap) return [];
            if (Array.isArray(snap)) return snap;
            if (snap?.messages && Array.isArray(snap.messages)) return snap.messages;
            return [snap];
        });
        const refresh = () => props.onRefresh?.();
        return { entries, refresh };
    },
    template: `
        <section class="panel">
            <header class="panel__header">
                <h3 class="panel__title">Story log</h3>
                <button type="button" class="button button--small" @click="refresh">Refresh</button>
            </header>
            <ul class="panel__list panel__list--dense" v-if="entries.length">
                <li v-for="entry in entries" :key="entry.id || entry.issuedAt" class="panel__list-item">
                    <strong>{{ entry.author || entry.senderName || 'Narrator' }}</strong>
                    <span>{{ entry.content || entry.message }}</span>
                </li>
            </ul>
            <p v-else class="panel__placeholder">No story log messages yet.</p>
        </section>
    `,
};

const HelpPanel = {
    name: 'HelpPanel',
    props: {
        docs: { type: [Array, Object], default: null },
        onRefresh: { type: Function, default: null },
    },
    setup(props) {
        const refresh = () => props.onRefresh?.();
        const entries = computed(() => {
            const raw = props.docs;
            if (Array.isArray(raw)) return raw;
            if (raw && typeof raw === 'object') {
                return Object.entries(raw).map(([key, value]) => ({ key, value }));
            }
            return [];
        });
        return { refresh, entries };
    },
    template: `
        <section class="panel">
            <header class="panel__header">
                <h3 class="panel__title">Help & documentation</h3>
                <button type="button" class="button button--small" @click="refresh">Refresh</button>
            </header>
            <ul class="panel__list" v-if="entries.length">
                <li v-for="entry in entries" :key="entry.key" class="panel__list-item">
                    <strong>{{ entry.key }}</strong>
                    <span>{{ typeof entry.value === 'string' ? entry.value : 'Document ready' }}</span>
                </li>
            </ul>
            <p v-else class="panel__placeholder">No documentation available.</p>
        </section>
    `,
};
</script>

<style scoped>
.app-shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem;
    color: var(--color-text, #f8f9fa);
    background: var(--color-bg, #1d1f2f);
    font-family: 'Inter', system-ui, sans-serif;
}

.app-shell__header {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.app-shell__title {
    margin: 0;
    font-size: 1.75rem;
    font-weight: 600;
}

.app-shell__subtitle {
    margin: 0;
    color: rgba(255, 255, 255, 0.7);
}

.app-shell__body {
    display: grid;
    grid-template-columns: minmax(16rem, 20rem) 1fr;
    gap: 1.5rem;
}

.app-shell__sidebar {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

.app-shell__content {
    background: rgba(12, 15, 30, 0.7);
    border-radius: 1rem;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    box-shadow: 0 20px 45px rgba(0, 0, 0, 0.35);
}

.app-shell__content-header h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
}

.app-shell__content-meta {
    margin: 0;
    color: rgba(255, 255, 255, 0.65);
    font-size: 0.9rem;
}

.app-shell__games {
    background: rgba(12, 15, 30, 0.7);
    border-radius: 1rem;
    padding: 1rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
}

.app-shell__section-title {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    font-weight: 600;
}

.game-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.game-list__item {
    border-radius: 0.75rem;
    overflow: hidden;
}

.game-list__item.is-active {
    box-shadow: 0 0 0 2px rgba(90, 173, 255, 0.7);
}

.game-list__button {
    width: 100%;
    padding: 0.75rem 1rem;
    text-align: left;
    background: rgba(30, 36, 58, 0.9);
    border: none;
    color: inherit;
    cursor: pointer;
    transition: background 0.2s ease;
}

.game-list__button:hover {
    background: rgba(45, 60, 90, 0.95);
}

.game-list__name {
    display: block;
    font-weight: 600;
}

.game-list__meta {
    display: block;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.6);
}

.app-shell__actions {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.button {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    padding: 0.6rem 1rem;
    border-radius: 999px;
    border: none;
    cursor: pointer;
    font-weight: 600;
    color: #0b1628;
    background: linear-gradient(135deg, #5aadff, #82f8ff);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.button:hover {
    transform: translateY(-1px);
    box-shadow: 0 12px 25px rgba(80, 180, 255, 0.35);
}

.button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
}

.button--muted {
    background: rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.85);
    box-shadow: none;
}

.button--small {
    font-size: 0.8rem;
    padding: 0.4rem 0.75rem;
}

.app-shell__loading,
.app-shell__placeholder,
.app-shell__error {
    font-size: 1rem;
    color: rgba(255, 255, 255, 0.75);
}

.app-shell__error {
    color: #ff8a8a;
}

.panel {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.panel__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
}

.panel__title {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
}

.panel__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    gap: 1rem;
}

.panel__stat {
    background: rgba(12, 15, 30, 0.6);
    border-radius: 1rem;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.panel__stat-label {
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.6);
}

.panel__stat-value {
    font-size: 1.25rem;
    font-weight: 600;
}

.panel__section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.panel__section-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
}

.panel__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.panel__list--dense {
    gap: 0.35rem;
}

.panel__list-item {
    padding: 0.6rem 0.75rem;
    border-radius: 0.75rem;
    background: rgba(12, 15, 30, 0.55);
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
}

.panel__placeholder {
    color: rgba(255, 255, 255, 0.55);
}

@media (max-width: 960px) {
    .app-shell__body {
        grid-template-columns: 1fr;
    }

    .app-shell__sidebar {
        order: 2;
    }
}
</style>
