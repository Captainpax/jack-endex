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
                <div v-else class="masterbot-layout">
                    <form class="masterbot-form" @submit.prevent="handleSaveMasterBot">
                        <div class="masterbot-form__grid">
                            <div class="form-field" :class="{ 'form-field--error': masterBotFormErrors.prefix }">
                                <label class="form-field__label" for="masterbot-prefix">Command prefix</label>
                                <input
                                    id="masterbot-prefix"
                                    v-model="masterBotForm.prefix"
                                    type="text"
                                    maxlength="16"
                                    @input="clearMasterBotFieldError('prefix')"
                                />
                                <p v-if="masterBotFormErrors.prefix" class="form-field__error">
                                    {{ masterBotFormErrors.prefix }}
                                </p>
                            </div>
                            <div class="form-field">
                                <label class="form-field__label" for="masterbot-display">Display name</label>
                                <input
                                    id="masterbot-display"
                                    v-model="masterBotForm.displayName"
                                    type="text"
                                    maxlength="100"
                                    placeholder="Jack Endex"
                                    @input="clearMasterBotFieldError('displayName')"
                                />
                            </div>
                            <div class="form-field form-field--full">
                                <label class="form-field__label" for="masterbot-status">Status text</label>
                                <textarea
                                    id="masterbot-status"
                                    v-model="masterBotForm.defaultPresence"
                                    rows="2"
                                    maxlength="256"
                                    placeholder="Running the Jack Endex bot"
                                    @input="clearMasterBotFieldError('defaultPresence')"
                                ></textarea>
                            </div>
                            <div class="form-field" :class="{ 'form-field--error': masterBotFormErrors.defaultInviteUrl }">
                                <label class="form-field__label" for="masterbot-invite">Default invite link</label>
                                <input
                                    id="masterbot-invite"
                                    v-model="masterBotForm.defaultInviteUrl"
                                    type="url"
                                    placeholder="https://discord.com/api/oauth2/authorize?..."
                                    @input="clearMasterBotFieldError('defaultInviteUrl')"
                                />
                                <p v-if="masterBotFormErrors.defaultInviteUrl" class="form-field__error">
                                    {{ masterBotFormErrors.defaultInviteUrl }}
                                </p>
                            </div>
                            <div class="form-field">
                                <label class="form-field__label" for="masterbot-client-id">OAuth client ID</label>
                                <input
                                    id="masterbot-client-id"
                                    v-model="masterBotForm.oauthClientId"
                                    type="text"
                                    maxlength="128"
                                    placeholder="123456789012345678"
                                    @input="clearMasterBotFieldError('oauthClientId')"
                                />
                            </div>
                            <div class="form-field">
                                <label class="form-field__label" for="masterbot-app-id">Application ID</label>
                                <input
                                    id="masterbot-app-id"
                                    v-model="masterBotForm.botApplicationId"
                                    type="text"
                                    maxlength="128"
                                    placeholder="123456789012345678"
                                    @input="clearMasterBotFieldError('botApplicationId')"
                                />
                            </div>
                            <div class="form-field form-field--full" :class="{ 'form-field--error': masterBotFormErrors.oauthRedirectUri }">
                                <label class="form-field__label" for="masterbot-redirect">OAuth redirect URL</label>
                                <input
                                    id="masterbot-redirect"
                                    v-model="masterBotForm.oauthRedirectUri"
                                    type="url"
                                    placeholder="https://jack-endex.example.com/api/discord/callback"
                                    @input="clearMasterBotFieldError('oauthRedirectUri')"
                                />
                                <p v-if="masterBotFormErrors.oauthRedirectUri" class="form-field__error">
                                    {{ masterBotFormErrors.oauthRedirectUri }}
                                </p>
                            </div>
                            <div class="form-field form-field--full" :class="{ 'form-field--error': masterBotFormErrors.avatarAsset }">
                                <label class="form-field__label" for="masterbot-avatar-url">Bot icon</label>
                                <div class="masterbot-avatar">
                                    <input
                                        id="masterbot-avatar-url"
                                        v-model="masterBotForm.avatarAsset"
                                        type="url"
                                        placeholder="https://cdn.discordapp.com/..."
                                        @input="handleAvatarUrlInput"
                                    />
                                    <div v-if="masterBotFormAvatarPreview" class="masterbot-avatar__preview">
                                        <img :src="masterBotFormAvatarPreview" alt="Bot icon preview" />
                                    </div>
                                </div>
                                <div class="masterbot-avatar__actions">
                                    <label class="button button--small masterbot-avatar__upload">
                                        <input type="file" accept="image/*" @change="handleAvatarFileChange" />
                                        Upload image
                                    </label>
                                    <button
                                        type="button"
                                        class="button button--small"
                                        :disabled="!masterBotForm.avatarAsset"
                                        @click="clearAvatarAsset"
                                    >
                                        Remove
                                    </button>
                                    <span v-if="masterBotAvatarFileName" class="masterbot-avatar__filename">
                                        {{ masterBotAvatarFileName }}
                                    </span>
                                </div>
                                <p v-if="masterBotFormErrors.avatarAsset" class="form-field__error">
                                    {{ masterBotFormErrors.avatarAsset }}
                                </p>
                            </div>
                        </div>
                        <div class="masterbot-form__messages">
                            <p v-if="masterBotSubmitError" class="panel__error">{{ masterBotSubmitError }}</p>
                            <p v-if="masterBotSaveNotice" class="panel__success">{{ masterBotSaveNotice }}</p>
                        </div>
                        <div class="masterbot-form__actions">
                            <button type="submit" class="button" :disabled="masterBotSaving">
                                {{ masterBotSaving ? 'Saving…' : 'Save settings' }}
                            </button>
                        </div>
                    </form>
                    <div class="masterbot-preview">
                        <template v-if="masterBotLoading">
                            <p class="panel__placeholder">Loading settings…</p>
                        </template>
                        <template v-else-if="masterBotHasPreview">
                            <div class="masterbot-preview__profile">
                                <div class="masterbot-preview__avatar">
                                    <template v-if="masterBotAvatarPreview">
                                        <img :src="masterBotAvatarPreview" alt="Bot avatar" />
                                    </template>
                                    <template v-else>
                                        🤖
                                    </template>
                                </div>
                                <div>
                                    <p class="masterbot-preview__name">
                                        {{ masterBotPreview.displayName?.trim() || 'Unnamed bot' }}
                                    </p>
                                    <p class="masterbot-preview__status">
                                        {{ masterBotPreview.defaultPresence?.trim() || 'No status configured yet.' }}
                                    </p>
                                </div>
                            </div>
                            <div class="masterbot-preview__meta" v-if="masterBotPreview.defaultInviteUrl?.trim()">
                                <p class="masterbot-preview__invite">{{ masterBotPreview.defaultInviteUrl }}</p>
                            </div>
                            <div class="masterbot-preview__actions">
                                <a
                                    v-if="masterBotPreview.defaultInviteUrl?.trim()"
                                    :href="masterBotPreview.defaultInviteUrl"
                                    class="button button--small masterbot-preview__link"
                                    target="_blank"
                                    rel="noopener"
                                >
                                    Open invite
                                </a>
                                <button
                                    type="button"
                                    class="button button--small"
                                    :disabled="!masterBotPreview.defaultInviteUrl?.trim()"
                                    @click="handleCopyInvite"
                                >
                                    {{ masterBotInviteCopyState === 'copied' ? 'Copied!' : 'Copy invite link' }}
                                </button>
                            </div>
                            <p v-if="masterBotInviteCopyError" class="panel__error">{{ masterBotInviteCopyError }}</p>
                        </template>
                        <template v-else>
                            <p class="panel__placeholder">No configuration saved yet.</p>
                        </template>
                    </div>
                </div>
            </section>
        </div>
    </section>
</template>

<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';

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

const MASTER_BOT_TEMPLATE = Object.freeze({
    prefix: '!',
    adminRoles: [],
    channelBindings: { announcements: '', logs: '', commands: '' },
    webhooks: { gameStart: '', alerts: '' },
    events: { sendGameStartMessage: true, autoSyncUsers: false, notifyDemonUpdate: false },
    oauth: { clientId: '', clientSecret: '', redirectUrl: '' },
    oauthClientId: '',
    oauthClientSecret: '',
    oauthRedirectUri: '',
    botToken: '',
    botApplicationId: '',
    defaultInviteUrl: '',
    defaultPresence: '',
    displayName: '',
    avatarAsset: '',
});

const masterBotForm = ref(createMasterBotForm());
const masterBotFormErrors = ref({});
const masterBotSaving = ref(false);
const masterBotSubmitError = ref('');
const masterBotSaveNotice = ref('');
const masterBotInviteCopyState = ref('');
const masterBotInviteCopyError = ref('');
const masterBotAvatarFileName = ref('');

const masterBotPreview = computed(() => (masterBot.value ? createMasterBotForm(masterBot.value) : null));
const masterBotHasPreview = computed(() => {
    const preview = masterBotPreview.value;
    if (!preview) return false;
    return Boolean(
        (preview.displayName && preview.displayName.trim()) ||
            (preview.defaultPresence && preview.defaultPresence.trim()) ||
            (preview.defaultInviteUrl && preview.defaultInviteUrl.trim()) ||
            (preview.avatarAsset && preview.avatarAsset.trim()),
    );
});
const masterBotAvatarPreview = computed(() => getAvatarPreview(masterBotPreview.value?.avatarAsset));
const masterBotFormAvatarPreview = computed(() => getAvatarPreview(masterBotForm.value.avatarAsset));

let masterBotSaveNoticeTimer = null;
let masterBotInviteTimer = null;

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
    masterBotLoading.value = false;
    masterBotError.value = '';
    masterBotForm.value = createMasterBotForm();
    masterBotFormErrors.value = {};
    masterBotSaving.value = false;
    masterBotSubmitError.value = '';
    masterBotSaveNotice.value = '';
    masterBotInviteCopyState.value = '';
    masterBotInviteCopyError.value = '';
    masterBotAvatarFileName.value = '';
    clearMasterBotTimers();
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
        syncMasterBotForm(result || {});
    } catch (error) {
        console.error('[admin] Failed to load master bot settings', error);
        masterBotError.value = 'Failed to load master bot settings.';
    } finally {
        masterBotLoading.value = false;
    }
}

function syncMasterBotForm(settings) {
    masterBotForm.value = createMasterBotForm(settings);
    masterBotFormErrors.value = {};
    masterBotSubmitError.value = '';
    masterBotAvatarFileName.value = '';
    masterBotInviteCopyState.value = '';
    masterBotInviteCopyError.value = '';
    setMasterBotSaveNotice('');
}

function clearMasterBotTimers() {
    if (masterBotSaveNoticeTimer) {
        clearTimeout(masterBotSaveNoticeTimer);
        masterBotSaveNoticeTimer = null;
    }
    if (masterBotInviteTimer) {
        clearTimeout(masterBotInviteTimer);
        masterBotInviteTimer = null;
    }
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function createMasterBotForm(seed = {}) {
    const source = isPlainObject(seed) ? seed : {};
    const oauthSource = isPlainObject(source.oauth) ? source.oauth : {};

    return {
        prefix: typeof source.prefix === 'string' ? source.prefix : MASTER_BOT_TEMPLATE.prefix,
        adminRoles: Array.isArray(source.adminRoles) ? [...source.adminRoles] : [...MASTER_BOT_TEMPLATE.adminRoles],
        channelBindings: {
            ...MASTER_BOT_TEMPLATE.channelBindings,
            ...(isPlainObject(source.channelBindings) ? source.channelBindings : {}),
        },
        webhooks: {
            ...MASTER_BOT_TEMPLATE.webhooks,
            ...(isPlainObject(source.webhooks) ? source.webhooks : {}),
        },
        events: {
            ...MASTER_BOT_TEMPLATE.events,
            ...(isPlainObject(source.events) ? source.events : {}),
        },
        oauthClientId:
            typeof source.oauthClientId === 'string'
                ? source.oauthClientId
                : typeof oauthSource.clientId === 'string'
                ? oauthSource.clientId
                : MASTER_BOT_TEMPLATE.oauthClientId,
        oauthClientSecret:
            typeof source.oauthClientSecret === 'string'
                ? source.oauthClientSecret
                : typeof oauthSource.clientSecret === 'string'
                ? oauthSource.clientSecret
                : MASTER_BOT_TEMPLATE.oauthClientSecret,
        oauthRedirectUri:
            typeof source.oauthRedirectUri === 'string'
                ? source.oauthRedirectUri
                : typeof oauthSource.redirectUrl === 'string'
                ? oauthSource.redirectUrl
                : MASTER_BOT_TEMPLATE.oauthRedirectUri,
        botToken: typeof source.botToken === 'string' ? source.botToken : MASTER_BOT_TEMPLATE.botToken,
        botApplicationId:
            typeof source.botApplicationId === 'string'
                ? source.botApplicationId
                : MASTER_BOT_TEMPLATE.botApplicationId,
        defaultInviteUrl:
            typeof source.defaultInviteUrl === 'string'
                ? source.defaultInviteUrl
                : MASTER_BOT_TEMPLATE.defaultInviteUrl,
        defaultPresence:
            typeof source.defaultPresence === 'string'
                ? source.defaultPresence
                : MASTER_BOT_TEMPLATE.defaultPresence,
        displayName:
            typeof source.displayName === 'string' ? source.displayName : MASTER_BOT_TEMPLATE.displayName,
        avatarAsset:
            typeof source.avatarAsset === 'string' ? source.avatarAsset : MASTER_BOT_TEMPLATE.avatarAsset,
        oauth: {
            clientId:
                typeof oauthSource.clientId === 'string'
                    ? oauthSource.clientId
                    : typeof source.oauthClientId === 'string'
                    ? source.oauthClientId
                    : MASTER_BOT_TEMPLATE.oauth.clientId,
            clientSecret:
                typeof oauthSource.clientSecret === 'string'
                    ? oauthSource.clientSecret
                    : typeof source.oauthClientSecret === 'string'
                    ? source.oauthClientSecret
                    : MASTER_BOT_TEMPLATE.oauth.clientSecret,
            redirectUrl:
                typeof oauthSource.redirectUrl === 'string'
                    ? oauthSource.redirectUrl
                    : typeof source.oauthRedirectUri === 'string'
                    ? source.oauthRedirectUri
                    : MASTER_BOT_TEMPLATE.oauth.redirectUrl,
        },
    };
}

function sanitizeOptionalString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function sanitizePrefix(value) {
    const trimmed = sanitizeOptionalString(value);
    return trimmed || '!';
}

function getAvatarPreview(value) {
    const input = sanitizeOptionalString(value);
    if (!input) return '';
    if (isDataImage(input)) return input;
    if (isValidHttpUrl(input)) return input;
    return '';
}

function isValidHttpUrl(value) {
    const input = sanitizeOptionalString(value);
    if (!input) return false;
    try {
        const url = new URL(input);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function isDataImage(value) {
    return /^data:image\//i.test(value || '');
}

function validateMasterBotForm(form) {
    const errors = {};
    if (!sanitizePrefix(form.prefix)) {
        errors.prefix = 'Prefix is required.';
    }
    const redirectUrl = sanitizeOptionalString(form.oauthRedirectUri);
    if (redirectUrl && !isValidHttpUrl(redirectUrl)) {
        errors.oauthRedirectUri = 'Enter a valid redirect URL.';
    }
    const inviteUrl = sanitizeOptionalString(form.defaultInviteUrl);
    if (inviteUrl && !isValidHttpUrl(inviteUrl)) {
        errors.defaultInviteUrl = 'Enter a valid invite link.';
    }
    const avatarValue = sanitizeOptionalString(form.avatarAsset);
    if (avatarValue && !isDataImage(avatarValue) && !isValidHttpUrl(avatarValue)) {
        errors.avatarAsset = 'Upload an image or supply a valid image URL.';
    }
    return errors;
}

function clearMasterBotFieldError(field) {
    if (!field) return;
    if (!masterBotFormErrors.value[field]) return;
    const next = { ...masterBotFormErrors.value };
    delete next[field];
    masterBotFormErrors.value = next;
}

function setMasterBotFieldError(field, message) {
    if (!field) return;
    masterBotFormErrors.value = { ...masterBotFormErrors.value, [field]: message };
}

function prepareMasterBotPayload(form, previous) {
    const base = createMasterBotForm(previous || {});
    const next = createMasterBotForm(form || {});
    const payload = {
        ...base,
        ...next,
        adminRoles: next.adminRoles,
        channelBindings: next.channelBindings,
        webhooks: next.webhooks,
        events: next.events,
    };

    payload.prefix = sanitizePrefix(next.prefix);
    payload.displayName = sanitizeOptionalString(next.displayName);
    payload.defaultPresence = sanitizeOptionalString(next.defaultPresence);
    payload.defaultInviteUrl = sanitizeOptionalString(next.defaultInviteUrl);
    payload.botApplicationId = sanitizeOptionalString(next.botApplicationId);
    payload.oauthClientId = sanitizeOptionalString(next.oauthClientId);
    payload.oauthClientSecret = typeof next.oauthClientSecret === 'string' ? next.oauthClientSecret.trim() : '';
    payload.oauthRedirectUri = sanitizeOptionalString(next.oauthRedirectUri);
    payload.avatarAsset = typeof next.avatarAsset === 'string' ? next.avatarAsset.trim() : '';
    payload.botToken = typeof next.botToken === 'string' ? next.botToken.trim() : '';
    payload.oauth = {
        clientId: payload.oauthClientId,
        clientSecret: payload.oauthClientSecret,
        redirectUrl: payload.oauthRedirectUri,
    };

    return payload;
}

function handleAvatarUrlInput() {
    masterBotAvatarFileName.value = '';
    clearMasterBotFieldError('avatarAsset');
}

async function handleAvatarFileChange(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) {
        setMasterBotFieldError('avatarAsset', 'Please choose an image file.');
        masterBotForm.value.avatarAsset = '';
        masterBotAvatarFileName.value = '';
        if (event?.target) event.target.value = '';
        return;
    }

    try {
        const dataUrl = await readFileAsDataUrl(file);
        if (!dataUrl) {
            setMasterBotFieldError('avatarAsset', 'Unable to read the selected image.');
        } else {
            masterBotForm.value.avatarAsset = dataUrl;
            masterBotAvatarFileName.value = file.name || '';
            clearMasterBotFieldError('avatarAsset');
        }
    } catch (error) {
        console.error('[admin] Failed to load bot avatar', error);
        setMasterBotFieldError('avatarAsset', 'Failed to process the selected image.');
        masterBotForm.value.avatarAsset = '';
        masterBotAvatarFileName.value = '';
    } finally {
        if (event?.target) {
            event.target.value = '';
        }
    }
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            resolve(typeof reader.result === 'string' ? reader.result : '');
        };
        reader.onerror = () => {
            reject(new Error('Failed to read file.'));
        };
        reader.readAsDataURL(file);
    });
}

async function handleCopyInvite() {
    const invite = sanitizeOptionalString(masterBotPreview.value?.defaultInviteUrl);
    if (!invite) return;
    masterBotInviteCopyError.value = '';

    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(invite);
        } else if (typeof document !== 'undefined') {
            const textarea = document.createElement('textarea');
            textarea.value = invite;
            textarea.setAttribute('readonly', 'readonly');
            textarea.style.position = 'absolute';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        } else {
            throw new Error('Clipboard unavailable');
        }
        masterBotInviteCopyState.value = 'copied';
        if (masterBotInviteTimer) {
            clearTimeout(masterBotInviteTimer);
        }
        masterBotInviteTimer = setTimeout(() => {
            masterBotInviteCopyState.value = '';
            masterBotInviteTimer = null;
        }, 2000);
    } catch (error) {
        console.error('[admin] Failed to copy master bot invite', error);
        masterBotInviteCopyError.value = 'Unable to copy the invite link.';
    }
}

function setMasterBotSaveNotice(message) {
    masterBotSaveNotice.value = message;
    if (masterBotSaveNoticeTimer) {
        clearTimeout(masterBotSaveNoticeTimer);
        masterBotSaveNoticeTimer = null;
    }
    if (message) {
        masterBotSaveNoticeTimer = setTimeout(() => {
            masterBotSaveNotice.value = '';
            masterBotSaveNoticeTimer = null;
        }, 4000);
    }
}

async function handleSaveMasterBot() {
    if (masterBotSaving.value) return;
    const errors = validateMasterBotForm(masterBotForm.value);
    masterBotFormErrors.value = errors;
    if (Object.keys(errors).length) {
        masterBotSubmitError.value = 'Please resolve the highlighted fields.';
        return;
    }

    masterBotSubmitError.value = '';
    masterBotSaving.value = true;

    const previousSnapshot = masterBot.value ? JSON.parse(JSON.stringify(masterBot.value)) : null;
    const previousForm = masterBot.value ? createMasterBotForm(masterBot.value) : null;
    if (previousForm) {
        masterBot.value = createMasterBotForm({ ...previousForm, ...masterBotForm.value });
    } else {
        masterBot.value = createMasterBotForm(masterBotForm.value);
    }

    try {
        const payload = prepareMasterBotPayload(masterBotForm.value, previousSnapshot || previousForm);
        const saved = await ServerAdmin.masterBot.update(payload);
        masterBot.value = saved || null;
        syncMasterBotForm(saved || {});
        setMasterBotSaveNotice('Settings saved.');
    } catch (error) {
        console.error('[admin] Failed to update master bot settings', error);
        masterBot.value = previousSnapshot || null;
        setMasterBotSaveNotice('');
        masterBotSubmitError.value = error?.message
            ? `Failed to save master bot settings: ${error.message}`
            : 'Failed to save master bot settings.';
    } finally {
        masterBotSaving.value = false;
    }
}

function clearAvatarAsset() {
    masterBotForm.value.avatarAsset = '';
    masterBotAvatarFileName.value = '';
    clearMasterBotFieldError('avatarAsset');
}

onUnmounted(() => {
    clearMasterBotTimers();
});
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

.panel__success {
    margin: 0;
    color: #4ade80;
}

.masterbot-layout {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

@media (min-width: 900px) {
    .masterbot-layout {
        flex-direction: row;
        align-items: flex-start;
    }
}

.masterbot-form {
    flex: 1 1 50%;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    border-radius: 0.75rem;
    background: rgba(255, 255, 255, 0.04);
}

.masterbot-form__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.75rem;
}

.form-field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}

.form-field--full {
    grid-column: 1 / -1;
}

.form-field__label {
    font-size: 0.8rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.75);
}

.form-field input,
.form-field textarea {
    width: 100%;
    padding: 0.5rem 0.65rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(15, 23, 42, 0.5);
    color: rgba(255, 255, 255, 0.85);
}

.form-field--error input,
.form-field--error textarea {
    border-color: rgba(255, 123, 123, 0.6);
}

.form-field__error {
    margin: 0;
    font-size: 0.75rem;
    color: #ff7b7b;
}

.masterbot-form__messages {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}

.masterbot-form__actions {
    display: flex;
    justify-content: flex-end;
}

.masterbot-avatar {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.masterbot-avatar__preview {
    width: 64px;
    height: 64px;
    border-radius: 0.75rem;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
}

.masterbot-avatar__preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.masterbot-avatar__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
}

.masterbot-avatar__upload {
    position: relative;
    overflow: hidden;
}

.masterbot-avatar__upload input[type='file'] {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
}

.masterbot-avatar__filename {
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.6);
}

.masterbot-preview {
    flex: 1 1 45%;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    border-radius: 0.75rem;
    background: rgba(255, 255, 255, 0.04);
}

.masterbot-preview__profile {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.masterbot-preview__avatar {
    width: 64px;
    height: 64px;
    border-radius: 0.75rem;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
}

.masterbot-preview__avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.masterbot-preview__name {
    margin: 0;
    font-weight: 600;
}

.masterbot-preview__status {
    margin: 0;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.65);
}

.masterbot-preview__meta {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.6);
}

.masterbot-preview__invite {
    margin: 0;
    word-break: break-all;
    font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.masterbot-preview__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
}

.masterbot-preview__link {
    text-decoration: none;
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
