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
                <section class="app-shell__actions">
                    <button
                        type="button"
                        class="button"
                        @click="refreshActiveGame"
                        :disabled="refreshingCampaign"
                    >
                        {{ refreshingCampaign ? 'Refreshing…' : 'Refresh campaign' }}
                    </button>
                    <RouterLink class="button button--muted" :to="{ name: 'campaigns' }">
                        Switch campaign
                    </RouterLink>
                    <button type="button" class="button button--muted" @click="logout" :disabled="logoutBusy">
                        {{ logoutBusy ? 'Signing out…' : 'Sign out' }}
                    </button>
                </section>
            </aside>
            <section class="app-shell__content" v-if="activeGame">
                <header class="app-shell__content-header">
                    <h2>{{ activeGame.name }}</h2>
                    <p class="app-shell__content-meta">
                        DM · {{ describeGameDungeonMaster(activeGame) }} — Updated {{ formatUpdated(activeGame.updatedAt) }}
                    </p>
                </header>
                <component :is="activeComponent" v-bind="activeComponentProps" />
            </section>
            <section class="app-shell__empty" v-else>
                <p v-if="error" class="app-shell__error">{{ error }}</p>
                <p v-else-if="emptyPlaceholder" class="app-shell__placeholder">{{ emptyPlaceholder }}</p>
            </section>
        </main>
        <p v-else class="app-shell__loading">Loading session…</p>
    </div>
</template>

<script setup>
import { computed, onMounted, provide, ref, unref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import NavigationSidebar from '../components/NavigationSidebar.vue';
import LoadingBar from '../components/LoadingBar.vue';
import MapTab from '../components/battleMap/MapTab.vue';
import ItemsTab from '../components/ItemsTab.vue';
import MySheetTab from '../components/MySheetTab.vue';
import DemonTab from '../components/DemonTab.vue';
import ServerManagementTab from '../components/ServerManagementTab.vue';
import CampaignSettings from '../components/CampaignSettings.vue';

import { Help, StoryLogs } from '../api';
import { buildNavigation } from '../constants/navigation';
import { realtimeSymbol, useRealtimeConnection } from '../composables/useRealtimeConnection';
import { useBattleLogger } from '../composables/useBattleLogger';
import { useAuthStore } from '../composables/useAuthStore';
import { useGamesStore } from '../composables/useGamesStore';
import {
    describeGameDungeonMaster,
    describePlayer,
    formatGameUpdated,
} from '../utils/gameDescriptions';
import { idsMatch } from '../utils/ids';

const DEFAULT_TAB = 'overview';
const DEFAULT_SHEET_SECTION = 'character';
const SHEET_SECTION_KEYS = new Set(['character', 'gear', 'worldSkills']);
const LEGACY_SHEET_TABS = new Set(['gear', 'worldSkills']);
const SUPPORTED_TAB_KEYS = new Set([
    'overview',
    'map',
    'sheet',
    'items',
    'demons',
    'storyLogs',
    'settings',
    'help',
    'serverManagement',
]);
const ROUTE_TAB_KEYS = new Set([...SUPPORTED_TAB_KEYS, ...LEGACY_SHEET_TABS]);

const SERVER_ADMIN_USERNAMES = new Set(['captainpax', 'amzyoshio']);

function resolveRouteParam(value) {
    if (Array.isArray(value)) {
        return value.length ? String(value[0]) : '';
    }
    if (value == null) return '';
    return String(value);
}

function normalizeSheetSlug(value) {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
}

function normalizeSheetSection(value) {
    if (typeof value !== 'string') return DEFAULT_SHEET_SECTION;
    const normalized = value.trim();
    return SHEET_SECTION_KEYS.has(normalized) ? normalized : DEFAULT_SHEET_SECTION;
}

function normalizeDashboardRouteParams(params) {
    const normalized = {};
    const tab = resolveRouteParam(params?.tab);
    if (tab) {
        normalized.tab = tab;
    }
    const slug = normalizeSheetSlug(resolveRouteParam(params?.sheetSlug));
    if (slug) {
        normalized.sheetSlug = slug;
    }
    const section = normalizeSheetSection(resolveRouteParam(params?.sheetSection));
    if (section && section !== DEFAULT_SHEET_SECTION) {
        normalized.sheetSection = section;
    }
    return normalized;
}

function extractDashboardRouteState(currentRoute) {
    const params = currentRoute?.params || {};
    const rawTab = resolveRouteParam(params.tab);
    let tab = ROUTE_TAB_KEYS.has(rawTab) ? rawTab : DEFAULT_TAB;
    let sheetSlug = '';
    let sheetSection = DEFAULT_SHEET_SECTION;

    if (LEGACY_SHEET_TABS.has(tab)) {
        sheetSection = tab;
        tab = 'sheet';
    }

    if (tab === 'sheet') {
        sheetSlug = normalizeSheetSlug(resolveRouteParam(params.sheetSlug));
        if (sheetSection !== DEFAULT_SHEET_SECTION) {
            sheetSection = normalizeSheetSection(sheetSection);
        } else {
            sheetSection = normalizeSheetSection(resolveRouteParam(params.sheetSection));
        }
    }

    return { tab, sheetSlug, sheetSection };
}

function buildDashboardRouteParams({ tab, sheetSlug, sheetSection }) {
    const params = {};
    if (tab && tab !== DEFAULT_TAB) {
        params.tab = tab;
    }
    if (tab === 'sheet') {
        const normalizedSlug = normalizeSheetSlug(sheetSlug);
        const normalizedSection = normalizeSheetSection(sheetSection);
        if (normalizedSlug) {
            params.sheetSlug = normalizedSlug;
        }
        if (normalizedSection && normalizedSection !== DEFAULT_SHEET_SECTION) {
            params.sheetSection = normalizedSection;
        }
    }
    return params;
}

function dashboardParamsDiffer(current, next) {
    const keys = new Set([...Object.keys(current || {}), ...Object.keys(next || {})]);
    for (const key of keys) {
        if ((current?.[key] ?? '') !== (next?.[key] ?? '')) {
            return true;
        }
    }
    return false;
}

function navigateToDashboard({ tab, sheetSlug, sheetSection }, { replace = false } = {}) {
    const params = buildDashboardRouteParams({ tab, sheetSlug, sheetSection });
    const method = replace ? router.replace : router.push;
    return method
        .call(router, { name: 'dashboard', params, query: { ...route.query } })
        .catch((error) => {
            if (error?.name !== 'NavigationDuplicated') {
                console.error(error);
            }
        });
}

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const gamesStore = useGamesStore();

const loading = ref(true);
const logoutBusy = ref(false);
const activeTab = ref(DEFAULT_TAB);
const activeSheetSlug = ref('');
const activeSheetSection = ref(DEFAULT_SHEET_SECTION);
const storyLogSnapshot = ref(null);
const helpDocList = ref([]);
const helpDocCache = ref({});
const error = ref('');

const me = computed(() => auth.user.value);
const activeGameId = computed(() => gamesStore.activeGameId.value);
const activeGame = computed(() => gamesStore.activeGame.value);
const refreshingCampaign = computed(
    () => gamesStore.loadingActiveGame.value || gamesStore.loadingList.value
);
const storeError = computed(() => gamesStore.error.value);

const realtime = useRealtimeConnection({ gameId: activeGameId });
provide(realtimeSymbol, realtime);

const battleLogger = useBattleLogger(activeGameId);

const emptyPlaceholder = computed(() => {
    if (loading.value) return '';
    if (refreshingCampaign.value) return 'Loading campaign…';
    if (!gamesStore.activeGameId.value) return 'Select a campaign to begin.';
    return '';
});

const formatUpdated = formatGameUpdated;

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
        case 'sheet':
            return MySheetTab;
        case 'demons':
            return DemonTab;
        case 'storyLogs':
            return StoryLogsPanel;
        case 'settings':
            return CampaignSettings;
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
            return { game, me: me.value, realtime, onUpdate: refreshActiveGame };
        case MySheetTab:
            return {
                game,
                me: me.value,
                slug: activeSheetSlug.value,
                section: activeSheetSection.value,
                'onUpdate:slug': handleSheetSlugChange,
                'onUpdate:section': handleSheetSectionChange,
            };
        case DemonTab:
            return { game, me: me.value };
        case StoryLogsPanel:
            return { snapshot: storyLogSnapshot.value, onRefresh: fetchStoryLog };
        case CampaignSettings:
            return {
                game,
                me: me.value,
                onRefreshGame: refreshActiveGame,
                onRefreshStory: fetchStoryLog,
            };
        case HelpPanel:
            return {
                docs: helpDocList.value,
                cache: helpDocCache.value,
                onRefresh: () => fetchHelpDocs({ resetCache: true }),
                onLoadDoc: fetchHelpDocContent,
            };
        case ServerManagementTab:
            return {
                activeGameId: game.id,
                onRefreshGames: refreshGames,
                onRefreshActiveGame: refreshActiveGame,
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

function handleSelectTab(key) {
    if (!SUPPORTED_TAB_KEYS.has(key)) return;
    navigateToDashboard({
        tab: key,
        sheetSlug: key === 'sheet' ? activeSheetSlug.value : '',
        sheetSection: key === 'sheet' ? activeSheetSection.value : DEFAULT_SHEET_SECTION,
    });
}

function updateSheetRoute({ slug = activeSheetSlug.value, section = activeSheetSection.value } = {}) {
    const normalizedSlug = normalizeSheetSlug(slug);
    const normalizedSection = normalizeSheetSection(section);

    if (normalizedSlug !== activeSheetSlug.value) {
        activeSheetSlug.value = normalizedSlug;
    }
    if (normalizedSection !== activeSheetSection.value) {
        activeSheetSection.value = normalizedSection;
    }

    if (activeTab.value !== 'sheet') {
        return;
    }

    const currentState = extractDashboardRouteState(route);
    if (
        currentState.tab === 'sheet' &&
        currentState.sheetSlug === normalizedSlug &&
        currentState.sheetSection === normalizedSection
    ) {
        return;
    }

    navigateToDashboard(
        { tab: 'sheet', sheetSlug: normalizedSlug, sheetSection: normalizedSection },
        { replace: true }
    );
}

function handleSheetSlugChange(value) {
    updateSheetRoute({ slug: value, section: activeSheetSection.value });
}

function handleSheetSectionChange(value) {
    updateSheetRoute({ slug: activeSheetSlug.value, section: value });
}

async function initializeDashboard() {
    try {
        loading.value = true;
        if (!me.value) {
            await auth.fetchSession();
        }

        if (!me.value) {
            resetDashboard();
            await router.replace({ name: 'auth' });
            return;
        }

        await gamesStore.initialize();
        error.value = storeError.value || '';
        if (!gamesStore.activeGameId.value) {
            await router.replace({ name: 'campaigns' });
            return;
        }
        if (activeTab.value === 'storyLogs') {
            await fetchStoryLog();
        } else if (activeTab.value === 'help') {
            await fetchHelpDocs();
        }
    } catch (err) {
        console.error(err);
        error.value = err?.message || 'Failed to load session information.';
    } finally {
        loading.value = false;
    }
}

async function refreshGames() {
    try {
        await gamesStore.fetchGames();
        error.value = storeError.value || '';
    } catch (err) {
        console.error(err);
        error.value = err?.message || 'Failed to refresh campaigns.';
    }
}

async function refreshActiveGame() {
    if (!gamesStore.activeGameId.value) return;
    try {
        await gamesStore.refreshActiveGame();
        error.value = storeError.value || '';
    } catch (err) {
        console.error(err);
        error.value = err?.message || 'Failed to load campaign.';
        clearActiveGameState();
        gamesStore.setActiveGame(null);
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

async function fetchHelpDocs(options = {}) {
    const resetCache = options?.resetCache ?? false;
    if (resetCache) {
        helpDocCache.value = {};
    }
    if (!resetCache && helpDocList.value.length) {
        return;
    }
    try {
        const docs = await Help.docs();
        const list = Array.isArray(docs) ? docs : [];
        helpDocList.value = list;
        if (resetCache) {
            helpDocCache.value = {};
        } else {
            const valid = new Set(list.map((doc) => doc?.filename).filter(Boolean));
            const entries = Object.entries(helpDocCache.value || {}).filter(([key]) => valid.has(key));
            const nextCache = Object.fromEntries(entries);
            helpDocCache.value = nextCache;
        }
        error.value = '';
    } catch (err) {
        console.error(err);
        error.value = err?.message || 'Failed to load help content.';
        helpDocList.value = [];
    }
}

async function fetchHelpDocContent(filename) {
    const target = typeof filename === 'string' ? filename : '';
    if (!target) return '';
    const cache = helpDocCache.value || {};
    if (typeof cache[target] === 'string') {
        return cache[target];
    }
    try {
        const content = await Help.getDoc(target);
        const text = typeof content === 'string' ? content : '';
        helpDocCache.value = { ...cache, [target]: text };
        return text;
    } catch (err) {
        console.error(err);
        throw err;
    }
}

async function logout() {
    if (!me.value) return;
    try {
        logoutBusy.value = true;
        loading.value = true;
        await auth.logout();
        resetDashboard();
        await router.replace({ name: 'auth' });
    } catch (err) {
        console.error(err);
        error.value = err?.message || 'Failed to log out.';
    } finally {
        logoutBusy.value = false;
        loading.value = false;
    }
}

function resetDashboard() {
    gamesStore.reset();
    activeTab.value = DEFAULT_TAB;
    storyLogSnapshot.value = null;
    helpDocList.value = [];
    helpDocCache.value = {};
    error.value = '';
}

function clearActiveGameState() {
    storyLogSnapshot.value = null;
    helpDocList.value = [];
    helpDocCache.value = {};
}

watch(
    () => route.params,
    (params) => {
        const previousTab = activeTab.value;
        const { tab, sheetSlug, sheetSection } = extractDashboardRouteState(route);
        activeTab.value = tab;
        activeSheetSlug.value = sheetSlug;
        activeSheetSection.value = sheetSection;

        if (tab !== previousTab) {
            if (tab === 'storyLogs') {
                fetchStoryLog();
            } else if (tab === 'help') {
                fetchHelpDocs();
            }
        }

        const normalizedCurrent = normalizeDashboardRouteParams(params);
        const nextParams = buildDashboardRouteParams({ tab, sheetSlug, sheetSection });
        if (dashboardParamsDiffer(normalizedCurrent, nextParams)) {
            navigateToDashboard({ tab, sheetSlug, sheetSection }, { replace: true });
        }
    },
    { immediate: true }
);

watch(storeError, (message) => {
    if (message) {
        error.value = message;
    }
});

watch(
    activeGame,
    async (game) => {
        if (game?.id) {
            error.value = storeError.value || '';
            if (activeTab.value === 'storyLogs') {
                await fetchStoryLog();
            } else if (activeTab.value === 'help') {
                await fetchHelpDocs();
            }
            return;
        }

        clearActiveGameState();

        if (loading.value) return;
        const current = router.currentRoute.value;
        if (current?.name && current.name !== 'campaigns' && current.name !== 'auth') {
            try {
                await router.replace({ name: 'campaigns' });
            } catch (err) {
                console.error(err);
            }
        }
    }
);

watch(
    activeGameId,
    async (id, previous) => {
        if (id) return;
        if (previous && !loading.value) {
            try {
                await gamesStore.fetchGames();
            } catch (err) {
                console.error(err);
            }
        }
    }
);

onMounted(() => {
    initializeDashboard();
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
        const snapshot = computed(() => {
            const raw = props.snapshot;
            if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
                const messages = Array.isArray(raw.messages) ? raw.messages : [];
                const channel = raw.channel || raw.status?.channel || null;
                return {
                    enabled: !!raw.enabled,
                    status: raw.status || null,
                    channel,
                    config: raw.config || null,
                    fetchedAt: raw.fetchedAt || null,
                    messages,
                };
            }
            const messages = Array.isArray(raw) ? raw : [];
            return {
                enabled: false,
                status: null,
                channel: null,
                config: null,
                fetchedAt: null,
                messages,
            };
        });

        const status = computed(() => snapshot.value.status || null);
        const channel = computed(() => snapshot.value.channel || null);
        const entries = computed(() => snapshot.value.messages);
        const watcherEnabled = computed(() =>
            Boolean(snapshot.value.enabled && (status.value?.enabled ?? snapshot.value.enabled))
        );
        const statusPhase = computed(() => status.value?.phase || (watcherEnabled.value ? 'idle' : 'disabled'));
        const phaseLabels = {
            ready: 'Ready',
            idle: 'Idle',
            connecting: 'Connecting',
            error: 'Error',
            configuring: 'Configuring',
            missing_token: 'Missing token',
            unconfigured: 'Missing channel',
            disabled: 'Disabled',
        };
        const phaseLabel = computed(() => phaseLabels[statusPhase.value] || statusPhase.value || 'Unknown');
        const statusError = computed(() => status.value?.error || null);
        const disabledWarning = computed(() => {
            if (watcherEnabled.value) return null;
            if (!status.value) {
                return 'The Discord watcher is disabled for this campaign.';
            }
            if (status.value.phase === 'missing_token') {
                return status.value.error || 'No Discord bot token configured for this campaign.';
            }
            if (status.value.phase === 'unconfigured') {
                return status.value.error || 'No Discord channel configured for this campaign.';
            }
            return status.value.error || 'The Discord watcher is currently disabled.';
        });
        const adminHint = computed(() =>
            watcherEnabled.value
                ? null
                : 'Ask a server admin to configure the Discord bot token and channel ID in Server Management → Story Log.'
        );
        const pollInterval = computed(() => status.value?.pollIntervalMs || null);
        const fetchedAt = computed(() => snapshot.value.fetchedAt || null);

        const timestampFormatter = new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
        });
        const formatTimestamp = (value) => {
            if (!value) return 'Unknown time';
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return value;
            return timestampFormatter.format(date);
        };

        const formatFileSize = (bytes) => {
            if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '';
            const units = ['B', 'KB', 'MB', 'GB'];
            let size = bytes;
            let unitIndex = 0;
            while (size >= 1024 && unitIndex < units.length - 1) {
                size /= 1024;
                unitIndex += 1;
            }
            return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
        };

        const authorInitial = (entry) => {
            const author = entry?.author;
            const name = author?.displayName || author?.username || author?.id || '??';
            const initial = typeof name === 'string' && name.trim() ? name.trim().charAt(0).toUpperCase() : '?';
            return initial;
        };

        const refresh = () => props.onRefresh?.();
        return {
            entries,
            refresh,
            status,
            channel,
            watcherEnabled,
            statusPhase,
            phaseLabel,
            statusError,
            disabledWarning,
            adminHint,
            pollInterval,
            fetchedAt,
            formatTimestamp,
            formatFileSize,
            authorInitial,
        };
    },
    template: `
        <section class="panel">
            <header class="panel__header">
                <h3 class="panel__title">Story log</h3>
                <button type="button" class="button button--small" @click="refresh">Refresh</button>
            </header>
            <section class="story-log-panel__status" role="status">
                <span :class="['story-log-panel__badge', 'story-log-panel__badge--' + statusPhase]">
                    {{ phaseLabel }}
                </span>
                <div class="story-log-panel__status-body">
                    <p class="story-log-panel__status-line">
                        <strong>Phase:</strong>
                        <span>{{ phaseLabel }}</span>
                        <span class="story-log-panel__status-phase">({{ statusPhase }})</span>
                    </p>
                    <p v-if="pollInterval" class="story-log-panel__status-line">
                        <strong>Polling interval:</strong>
                        <span>{{ (pollInterval / 1000).toFixed(0) }}s</span>
                    </p>
                    <p v-if="fetchedAt" class="story-log-panel__status-line">
                        <strong>Last fetched:</strong>
                        <span>{{ formatTimestamp(fetchedAt) }}</span>
                    </p>
                    <p v-if="statusError" class="story-log-panel__status-error">{{ statusError }}</p>
                    <p v-else-if="disabledWarning" class="story-log-panel__status-error">{{ disabledWarning }}</p>
                    <p v-if="adminHint" class="story-log-panel__status-hint">{{ adminHint }}</p>
                </div>
            </section>
            <section class="story-log-panel__channel" v-if="channel">
                <div class="story-log-panel__channel-name">
                    <span class="story-log-panel__channel-label">Channel:</span>
                    <template v-if="channel.url">
                        <a :href="channel.url" target="_blank" rel="noopener" class="story-log-panel__channel-link">
                            #{{ channel.name || channel.id }}
                        </a>
                    </template>
                    <template v-else>
                        <span class="story-log-panel__channel-text">#{{ channel.name || channel.id }}</span>
                    </template>
                </div>
                <p v-if="channel.topic" class="story-log-panel__channel-topic">{{ channel.topic }}</p>
            </section>
            <p v-else class="story-log-panel__channel story-log-panel__channel--empty">
                Channel information is not available.
            </p>
            <ul class="story-log-panel__messages" v-if="entries.length">
                <li
                    v-for="entry in entries"
                    :key="entry.id || entry.createdAt || entry.issuedAt"
                    class="story-log-message"
                >
                    <div class="story-log-message__avatar">
                        <img
                            v-if="entry.author && entry.author.avatarUrl"
                            :src="entry.author.avatarUrl"
                            :alt="entry.author.displayName || entry.author.username || 'Author avatar'"
                        />
                        <span v-else class="story-log-message__avatar-fallback">{{ authorInitial(entry) }}</span>
                    </div>
                    <div class="story-log-message__body">
                        <header class="story-log-message__meta">
                            <span class="story-log-message__author">
                                {{ entry.author?.displayName || entry.author?.username || entry.author || entry.senderName || 'Narrator' }}
                            </span>
                            <time
                                class="story-log-message__timestamp"
                                :datetime="entry.createdAt || ''"
                                >{{ formatTimestamp(entry.createdAt) }}</time
                            >
                            <a
                                v-if="entry.jumpLink"
                                :href="entry.jumpLink"
                                target="_blank"
                                rel="noopener"
                                class="story-log-message__jump-link"
                            >
                                Open in Discord
                            </a>
                        </header>
                        <p v-if="entry.content || entry.message" class="story-log-message__content">
                            {{ entry.content || entry.message }}
                        </p>
                        <ul
                            v-if="entry.attachments && entry.attachments.length"
                            class="story-log-message__attachments"
                        >
                            <li
                                v-for="file in entry.attachments"
                                :key="file.id || file.url || file.proxyUrl"
                                class="story-log-message__attachment"
                            >
                                <a
                                    :href="file.url || file.proxyUrl"
                                    target="_blank"
                                    rel="noopener"
                                    class="story-log-message__attachment-link"
                                >
                                    {{ file.name || 'Attachment' }}
                                </a>
                                <span v-if="file.contentType" class="story-log-message__attachment-meta">
                                    {{ file.contentType }}
                                </span>
                                <span v-if="file.size" class="story-log-message__attachment-meta">
                                    {{ formatFileSize(file.size) }}
                                </span>
                            </li>
                        </ul>
                    </div>
                </li>
            </ul>
            <p v-else class="panel__placeholder">No story log messages yet.</p>
        </section>
    `,
};

const HelpPanel = {
    name: 'HelpPanel',
    props: {
        docs: { type: Array, default: () => [] },
        cache: { type: Object, default: () => ({}) },
        onRefresh: { type: Function, default: null },
        onLoadDoc: { type: Function, default: null },
    },
    setup(props) {
        const selected = ref('');
        const loading = ref(false);
        const content = ref('');
        const errorMessage = ref('');
        let activeToken = 0;

        const documents = computed(() => (Array.isArray(props.docs) ? props.docs : []));
        const selectedDoc = computed(() =>
            documents.value.find((doc) => doc?.filename === selected.value) || null
        );

        watch(
            documents,
            (list) => {
                if (!list.length) {
                    activeToken += 1;
                    selected.value = '';
                    content.value = '';
                    errorMessage.value = '';
                    loading.value = false;
                    return;
                }
                if (selected.value && !list.some((doc) => doc?.filename === selected.value)) {
                    activeToken += 1;
                    selected.value = '';
                    content.value = '';
                    errorMessage.value = '';
                    loading.value = false;
                }
            },
            { immediate: true }
        );

        watch(
            () => props.cache,
            (cache) => {
                if (!selected.value) return;
                const cached = cache?.[selected.value];
                if (typeof cached === 'string') {
                    content.value = cached;
                    errorMessage.value = '';
                    loading.value = false;
                }
            }
        );

        async function loadDocument(filename) {
            if (typeof props.onLoadDoc !== 'function') {
                content.value = '';
                errorMessage.value = '';
                loading.value = false;
                return;
            }
            activeToken += 1;
            const token = activeToken;
            loading.value = true;
            errorMessage.value = '';
            try {
                const text = await props.onLoadDoc(filename);
                if (token === activeToken && selected.value === filename) {
                    content.value = typeof text === 'string' ? text : '';
                }
            } catch (err) {
                if (token === activeToken && selected.value === filename) {
                    content.value = '';
                    errorMessage.value = err?.message || 'Failed to load document.';
                }
            } finally {
                if (token === activeToken && selected.value === filename) {
                    loading.value = false;
                }
            }
        }

        const selectDoc = (filename) => {
            const target = typeof filename === 'string' ? filename : '';
            if (!target) return;
            if (selected.value !== target) {
                selected.value = target;
            }
            const cached = props.cache?.[target];
            if (typeof cached === 'string') {
                content.value = cached;
                errorMessage.value = '';
                loading.value = false;
                return;
            }
            if (loading.value && target === selected.value) {
                return;
            }
            errorMessage.value = '';
            content.value = '';
            void loadDocument(target);
        };

        const refresh = () => {
            activeToken += 1;
            selected.value = '';
            content.value = '';
            errorMessage.value = '';
            loading.value = false;
            props.onRefresh?.();
        };

        return {
            documents,
            selected,
            selectedDoc,
            selectDoc,
            refresh,
            loading,
            content,
            errorMessage,
        };
    },
    template: `
        <section class="panel help-panel">
            <header class="panel__header">
                <h3 class="panel__title">Help & documentation</h3>
                <button type="button" class="button button--small" @click="refresh">Refresh</button>
            </header>
            <div v-if="documents.length" class="help-panel__body">
                <aside class="help-panel__list">
                    <ul class="help-panel__doc-list">
                        <li
                            v-for="doc in documents"
                            :key="doc.filename || doc.name"
                            class="help-panel__doc-item"
                        >
                            <button
                                type="button"
                                class="help-panel__doc-button"
                                :class="{ 'is-active': doc.filename === selected }"
                                @click="selectDoc(doc.filename)"
                            >
                                <span class="help-panel__doc-name">{{ doc.name || doc.filename }}</span>
                                <span
                                    v-if="doc.name && doc.name !== doc.filename"
                                    class="help-panel__doc-filename"
                                >
                                    {{ doc.filename }}
                                </span>
                            </button>
                        </li>
                    </ul>
                </aside>
                <article class="help-panel__viewer">
                    <header v-if="selectedDoc" class="help-panel__viewer-header">
                        <h4 class="help-panel__viewer-title">
                            {{ selectedDoc.name || selectedDoc.filename }}
                        </h4>
                        <span
                            v-if="selectedDoc.name && selectedDoc.name !== selectedDoc.filename"
                            class="help-panel__viewer-meta"
                        >
                            {{ selectedDoc.filename }}
                        </span>
                    </header>
                    <p v-if="!selected" class="help-panel__placeholder">
                        Choose a document to view its contents.
                    </p>
                    <p v-else-if="loading" class="help-panel__placeholder">Loading document…</p>
                    <p v-else-if="errorMessage" class="help-panel__error">{{ errorMessage }}</p>
                    <pre v-else class="help-panel__content">{{ content }}</pre>
                </article>
            </div>
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
    color: #f5f9ff;
    background: radial-gradient(circle at top left, rgba(15, 50, 110, 0.95), rgba(4, 9, 25, 0.98));
    padding: 1.5rem;
}

.app-shell__header {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0 0 1.5rem;
}

.app-shell__title {
    margin: 0;
    font-size: 2rem;
    font-weight: 700;
}

.app-shell__subtitle {
    margin: 0;
    font-size: 1rem;
    color: rgba(255, 255, 255, 0.7);
}

.app-shell__body {
    display: grid;
    grid-template-columns: 18rem 1fr;
    gap: 1.5rem;
}

.app-shell__sidebar {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
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

.story-log-panel__status {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
    background: rgba(12, 15, 30, 0.6);
    border-radius: 1rem;
    padding: 1rem 1.25rem;
    box-shadow: inset 0 0 0 1px rgba(120, 175, 255, 0.15);
}

.story-log-panel__badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem 0.85rem;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: rgba(96, 110, 255, 0.18);
    color: rgba(230, 236, 255, 0.95);
    min-width: 6rem;
}

.story-log-panel__badge--ready,
.story-log-panel__badge--idle {
    background: rgba(46, 204, 113, 0.2);
    color: #b2f5c8;
}

.story-log-panel__badge--connecting,
.story-log-panel__badge--configuring {
    background: rgba(46, 134, 222, 0.2);
    color: #9ad1ff;
}

.story-log-panel__badge--error,
.story-log-panel__badge--missing_token,
.story-log-panel__badge--unconfigured,
.story-log-panel__badge--disabled {
    background: rgba(231, 76, 60, 0.25);
    color: #ffb7b0;
}

.story-log-panel__status-body {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    color: rgba(255, 255, 255, 0.85);
}

.story-log-panel__status-line {
    margin: 0;
    font-size: 0.9rem;
    display: flex;
    gap: 0.4rem;
    align-items: baseline;
}

.story-log-panel__status-phase {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.6);
}

.story-log-panel__status-error {
    margin: 0;
    font-size: 0.9rem;
    color: #ff9d9d;
}

.story-log-panel__status-hint {
    margin: 0;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.7);
}

.story-log-panel__channel {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.75rem 1rem;
    border-radius: 0.9rem;
    background: rgba(12, 15, 30, 0.45);
    box-shadow: inset 0 0 0 1px rgba(120, 175, 255, 0.12);
}

.story-log-panel__channel--empty {
    color: rgba(255, 255, 255, 0.6);
}

.story-log-panel__channel-name {
    display: flex;
    gap: 0.35rem;
    align-items: baseline;
    font-size: 0.9rem;
}

.story-log-panel__channel-label {
    font-weight: 600;
    color: rgba(255, 255, 255, 0.7);
}

.story-log-panel__channel-link {
    color: #8cc6ff;
    text-decoration: none;
}

.story-log-panel__channel-link:hover {
    text-decoration: underline;
}

.story-log-panel__channel-text {
    color: rgba(255, 255, 255, 0.9);
}

.story-log-panel__channel-topic {
    margin: 0;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.65);
}

.story-log-panel__messages {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.story-log-message {
    display: flex;
    gap: 0.85rem;
    padding: 0.85rem 1rem;
    border-radius: 1rem;
    background: rgba(12, 17, 35, 0.55);
    box-shadow: inset 0 0 0 1px rgba(120, 175, 255, 0.08);
}

.story-log-message__avatar {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 999px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.story-log-message__avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.story-log-message__avatar-fallback {
    font-weight: 600;
    font-size: 1rem;
    color: rgba(255, 255, 255, 0.8);
}

.story-log-message__body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
}

.story-log-message__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: baseline;
}

.story-log-message__author {
    font-weight: 600;
    color: rgba(255, 255, 255, 0.95);
}

.story-log-message__timestamp {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.55);
}

.story-log-message__jump-link {
    font-size: 0.8rem;
    color: #8cc6ff;
    text-decoration: none;
    margin-left: auto;
}

.story-log-message__jump-link:hover {
    text-decoration: underline;
}

.story-log-message__content {
    margin: 0;
    white-space: pre-wrap;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.85);
    word-break: break-word;
}

.story-log-message__attachments {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}

.story-log-message__attachment {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.7);
}

.story-log-message__attachment-link {
    color: #8cc6ff;
    text-decoration: none;
    font-weight: 600;
}

.story-log-message__attachment-link:hover {
    text-decoration: underline;
}

.story-log-message__attachment-meta {
    color: rgba(255, 255, 255, 0.55);
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

.help-panel__body {
    display: grid;
    grid-template-columns: minmax(12rem, 15rem) 1fr;
    gap: 1.25rem;
    margin-top: 1rem;
}

.help-panel__list {
    background: rgba(12, 17, 35, 0.55);
    border-radius: 1rem;
    padding: 0.75rem;
    box-shadow: inset 0 0 0 1px rgba(120, 175, 255, 0.12);
}

.help-panel__doc-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.help-panel__doc-button {
    width: 100%;
    text-align: left;
    border: 1px solid rgba(130, 248, 255, 0.18);
    background: rgba(12, 15, 30, 0.35);
    border-radius: 0.75rem;
    padding: 0.6rem 0.75rem;
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition: border-color 0.2s ease, background 0.2s ease, transform 0.15s ease;
}

.help-panel__doc-button:hover {
    border-color: rgba(130, 248, 255, 0.4);
    background: rgba(130, 248, 255, 0.16);
}

.help-panel__doc-button.is-active {
    border-color: rgba(130, 248, 255, 0.55);
    background: rgba(130, 248, 255, 0.22);
    transform: translateX(2px);
}

.help-panel__doc-name {
    display: block;
    font-weight: 600;
}

.help-panel__doc-filename {
    display: block;
    font-size: 0.75rem;
    color: rgba(190, 240, 255, 0.7);
}

.help-panel__viewer {
    background: rgba(12, 17, 35, 0.5);
    border-radius: 1rem;
    padding: 1rem;
    box-shadow: inset 0 0 0 1px rgba(120, 175, 255, 0.12);
    min-height: 12rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.help-panel__viewer-header {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.help-panel__viewer-title {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
}

.help-panel__viewer-meta {
    font-size: 0.8rem;
    color: rgba(190, 240, 255, 0.7);
}

.help-panel__placeholder {
    margin: 0;
    color: rgba(190, 240, 255, 0.75);
}

.help-panel__error {
    margin: 0;
    color: #ffb0b0;
}

.help-panel__content {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.55;
    font-size: 0.9rem;
    font-family: 'Fira Code', 'SFMono-Regular', 'SFMono', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
        monospace;
    background: rgba(6, 9, 20, 0.65);
    border-radius: 0.85rem;
    padding: 1rem;
    max-height: 32rem;
    overflow: auto;
}

.help-panel__content::-webkit-scrollbar {
    width: 0.6rem;
}

.help-panel__content::-webkit-scrollbar-thumb {
    background: rgba(130, 248, 255, 0.3);
    border-radius: 999px;
}

.help-panel__content::-webkit-scrollbar-track {
    background: transparent;
}

@media (max-width: 960px) {
    .app-shell__body {
        grid-template-columns: 1fr;
    }

    .app-shell__sidebar {
        order: 2;
    }

    .help-panel__body {
        grid-template-columns: 1fr;
    }

    .help-panel__list {
        order: 2;
    }

    .help-panel__viewer {
        order: 1;
    }
}
</style>
