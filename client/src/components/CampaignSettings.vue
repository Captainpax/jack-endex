<template>
    <section class="panel campaign-settings">
        <header class="panel__header">
            <h3 class="panel__title">Campaign settings</h3>
            <button
                type="button"
                class="button button--small"
                @click="handleRefreshGame"
                :disabled="refreshingGame || !canRefreshGame"
            >
                {{ refreshingGame ? 'Refreshing…' : 'Refresh campaign' }}
            </button>
        </header>

        <p v-if="!isDM" class="panel__placeholder">
            Only the dungeon master can update campaign settings.
        </p>

        <div v-else class="campaign-settings__grid">
            <section class="campaign-settings__card">
                <header class="campaign-settings__card-header">
                    <h4 class="campaign-settings__card-title">Discord status</h4>
                    <button
                        type="button"
                        class="button button--small button--ghost"
                        @click="refreshGuilds"
                        :disabled="guildLoading || !hasDiscord"
                    >
                        {{ guildLoading ? 'Loading…' : 'Refresh servers' }}
                    </button>
                </header>
                <ul class="campaign-settings__summary">
                    <li>
                        <span class="campaign-settings__summary-label">Configured server</span>
                        <span class="campaign-settings__summary-value">{{ savedGuildSummary }}</span>
                    </li>
                    <li>
                        <span class="campaign-settings__summary-label">Configured channel</span>
                        <span class="campaign-settings__summary-value">{{ savedChannelSummary }}</span>
                    </li>
                    <li>
                        <span class="campaign-settings__summary-label">Invite status</span>
                        <span class="campaign-settings__summary-value">{{ inviteStatus }}</span>
                    </li>
                    <li>
                        <span class="campaign-settings__summary-label">Polling interval</span>
                        <span class="campaign-settings__summary-value">{{ savedPollingSummary }}</span>
                    </li>
                    <li>
                        <span class="campaign-settings__summary-label">Player posts</span>
                        <span class="campaign-settings__summary-value">{{ allowPlayerPostsSummary }}</span>
                    </li>
                </ul>
                <div class="campaign-settings__invite">
                    <button
                        type="button"
                        class="button"
                        @click="openInvite"
                        :disabled="!canOpenInvite"
                    >
                        {{ canOpenInvite ? 'Invite the bot to Discord' : 'Invite unavailable' }}
                    </button>
                    <p class="campaign-settings__hint" v-if="!canOpenInvite">
                        Ask a server admin to configure a Discord invite link for the primary bot.
                    </p>
                </div>
                <p v-if="storyBotTokenConfigured" class="campaign-settings__status campaign-settings__status--ok">
                    Bot token configured for this campaign.
                </p>
                <p
                    v-else
                    class="campaign-settings__status campaign-settings__status--warn"
                >
                    The Discord bot token is not configured. Ask an administrator to configure it in Server Management.
                </p>
                <p v-if="storyWebhookConfigured" class="campaign-settings__status campaign-settings__status--ok">
                    Webhook configured for story log delivery.
                </p>
                <p v-else class="campaign-settings__status campaign-settings__status--warn">
                    No webhook configured yet. Select a server and channel, then save your changes to enable logging.
                </p>
            </section>

            <section class="campaign-settings__card">
                <h4 class="campaign-settings__card-title">Discord story log</h4>
                <p v-if="!hasDiscord" class="campaign-settings__notice">
                    Connect your Discord account to choose a server for the story log.
                    <a class="button button--small" :href="discordConnectUrl">Connect Discord</a>
                </p>

                <template v-else>
                    <div class="campaign-settings__field">
                        <div class="campaign-settings__field-header">
                            <label class="campaign-settings__label" for="campaign-settings-guild">Discord server</label>
                            <button
                                type="button"
                                class="button button--small button--ghost"
                                @click="refreshGuilds"
                                :disabled="guildLoading"
                            >
                                {{ guildLoading ? 'Loading…' : 'Reload' }}
                            </button>
                        </div>
                        <select
                            id="campaign-settings-guild"
                            v-model="form.guildId"
                            :disabled="guildLoading || !guilds.length"
                        >
                            <option value="" disabled>Select a Discord server</option>
                            <option v-for="guild in guilds" :key="guild.id" :value="guild.id">
                                {{ guild.name }}
                            </option>
                        </select>
                        <p v-if="guildError" class="campaign-settings__error">{{ guildError }}</p>
                        <p v-else-if="guildLoading" class="campaign-settings__hint">Loading servers…</p>
                    </div>

                    <div class="campaign-settings__field">
                        <div class="campaign-settings__field-header">
                            <label class="campaign-settings__label" for="campaign-settings-channel">Discord channel</label>
                            <button
                                type="button"
                                class="button button--small button--ghost"
                                @click="refreshChannels"
                                :disabled="!form.guildId || channelLoading"
                            >
                                {{ channelLoading ? 'Loading…' : 'Reload' }}
                            </button>
                        </div>
                        <select
                            id="campaign-settings-channel"
                            v-model="form.channelId"
                            :disabled="!form.guildId || channelLoading || !channels.length"
                        >
                            <option value="" disabled>Select a Discord channel</option>
                            <option v-for="channel in channels" :key="channel.id" :value="channel.id">
                                {{ formatChannelLabel(channel) }}
                            </option>
                        </select>
                        <p v-if="channelError" class="campaign-settings__error">{{ channelError }}</p>
                        <p v-else-if="channelLoading" class="campaign-settings__hint">Loading channels…</p>
                        <ul v-if="selectedChannelWarnings.length" class="campaign-settings__warnings">
                            <li v-for="warning in selectedChannelWarnings" :key="warning">{{ warning }}</li>
                        </ul>
                        <p v-if="botPresenceSummary" class="campaign-settings__hint">{{ botPresenceSummary }}</p>
                    </div>

                    <div class="campaign-settings__field campaign-settings__field--inline">
                        <label class="campaign-settings__checkbox">
                            <input type="checkbox" v-model="form.allowPlayerPosts" />
                            Allow players to post to Discord
                        </label>
                    </div>

                    <div class="campaign-settings__field">
                        <label class="campaign-settings__label" for="campaign-settings-poll">Polling interval (seconds)</label>
                        <input
                            id="campaign-settings-poll"
                            type="number"
                            min="5"
                            max="120"
                            step="1"
                            v-model.number="form.pollIntervalSeconds"
                        />
                        <p class="campaign-settings__hint">
                            The watcher will sync roughly every {{ currentPollIntervalSeconds }} seconds.
                        </p>
                    </div>

                    <p v-if="saveError" class="campaign-settings__error">{{ saveError }}</p>
                    <p v-if="saveNotice" class="campaign-settings__success">{{ saveNotice }}</p>

                    <div class="campaign-settings__actions">
                        <button
                            type="button"
                            class="button"
                            @click="saveSettings"
                            :disabled="saving || !isDirty"
                        >
                            {{ saving ? 'Saving…' : 'Save changes' }}
                        </button>
                        <button
                            type="button"
                            class="button button--muted"
                            @click="resetForm"
                            :disabled="saving || !isDirty"
                        >
                            Reset
                        </button>
                    </div>
                </template>
            </section>
        </div>
    </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';

import { Auth, Discord, StoryLogs } from '../api';
import { idsMatch } from '../utils/ids';

const props = defineProps({
    game: { type: Object, required: true },
    me: { type: Object, default: null },
    onRefreshGame: { type: Function, default: null },
    onRefreshStory: { type: Function, default: null },
});

const form = reactive({
    guildId: '',
    channelId: '',
    allowPlayerPosts: false,
    pollIntervalSeconds: 15,
});

const guilds = ref([]);
const channels = ref([]);
const guildLoading = ref(false);
const channelLoading = ref(false);
const guildError = ref('');
const channelError = ref('');
const saving = ref(false);
const saveError = ref('');
const saveNotice = ref('');
const refreshingGame = ref(false);
const channelBotStatus = ref(null);
let channelRequestToken = 0;

const isDM = computed(() => idsMatch(props.game?.dmId, props.me?.id));
const hasDiscord = computed(() => !!props.me?.discord?.id);
const canRefreshGame = computed(() => typeof props.onRefreshGame === 'function');

const storyConfig = computed(() =>
    props.game && typeof props.game.story === 'object' ? props.game.story : {},
);
const storyGuildId = computed(() => storyConfig.value?.guildId || '');
const storyGuildName = computed(() => storyConfig.value?.guildName || '');
const storyChannelId = computed(() => storyConfig.value?.channelId || '');
const storyChannelName = computed(() => storyConfig.value?.channelName || '');
const storyAllowPosts = computed(() => !!storyConfig.value?.allowPlayerPosts);
const storyPollIntervalMs = computed(() => {
    const raw = Number(storyConfig.value?.pollIntervalMs);
    return Number.isFinite(raw) ? raw : 15_000;
});
const storyPrimaryBot = computed(() =>
    storyConfig.value?.primaryBot && typeof storyConfig.value.primaryBot === 'object'
        ? storyConfig.value.primaryBot
        : {},
);
const storyWebhookConfigured = computed(() => !!storyConfig.value?.webhookConfigured);
const storyBotTokenConfigured = computed(() => !!storyConfig.value?.botTokenConfigured);

const defaultGuildId = computed(() => storyPrimaryBot.value?.defaultGuildId || '');
const defaultChannelId = computed(() => storyPrimaryBot.value?.defaultChannelId || '');
const inviteUrl = computed(() => storyPrimaryBot.value?.inviteUrl || '');

const pollIntervalSecondsOriginal = computed(() =>
    normalizePollIntervalSeconds(storyPollIntervalMs.value / 1000, 15),
);
const currentPollIntervalSeconds = computed(() =>
    normalizePollIntervalSeconds(form.pollIntervalSeconds, pollIntervalSecondsOriginal.value),
);

const savedGuildSummary = computed(() =>
    storyGuildName.value || (storyGuildId.value ? `Guild ${storyGuildId.value}` : 'Not configured'),
);
const savedChannelSummary = computed(() =>
    storyChannelName.value
        || (storyChannelId.value ? `Channel ${storyChannelId.value}` : 'Not configured'),
);
const savedPollingSummary = computed(
    () => `${normalizePollIntervalSeconds(storyPollIntervalMs.value / 1000, 15)}s`,
);
const allowPlayerPostsSummary = computed(() =>
    storyAllowPosts.value ? 'Enabled' : 'Disabled',
);

const inviteStatus = computed(() => {
    if (!storyPrimaryBot.value?.available) {
        return 'Bot unavailable';
    }
    if (inviteUrl.value) {
        return 'Invite link ready';
    }
    return 'No invite link configured';
});

const canOpenInvite = computed(() => !!inviteUrl.value);
const discordConnectUrl = computed(() => {
    const redirect = typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search}`
        : '/dashboard';
    return Auth.discordStartUrl({ redirect: redirect || '/dashboard' });
});

const selectedGuild = computed(() =>
    guilds.value.find((guild) => guild && guild.id === form.guildId) || null,
);
const selectedChannel = computed(() =>
    channels.value.find((channel) => channel && channel.id === form.channelId) || null,
);
const selectedChannelWarnings = computed(() => {
    const warnings = [];
    const channel = selectedChannel.value;
    if (!channel) return warnings;
    if (channel.botCanRead === false) {
        warnings.push('The bot cannot read messages in this channel.');
    }
    if (channel.botCanPost === false) {
        warnings.push('The bot cannot post messages in this channel.');
    }
    return warnings;
});

const botPresenceSummary = computed(() => {
    const status = channelBotStatus.value;
    if (!status) return '';
    if (status.present === false) {
        return 'The Jack Endex bot is not currently a member of this server.';
    }
    if (status.permissionsKnown === false) {
        return status.reason || 'Unable to verify the bot’s permissions for this server.';
    }
    if (status.present) {
        return 'Bot detected in this server.';
    }
    return status.reason || '';
});

const originalState = computed(() => ({
    guildId: storyGuildId.value,
    channelId: storyChannelId.value,
    allowPlayerPosts: storyAllowPosts.value,
    pollIntervalSeconds: pollIntervalSecondsOriginal.value,
}));

const isDirty = computed(() => {
    if (form.guildId !== originalState.value.guildId) return true;
    if (form.channelId !== originalState.value.channelId) return true;
    if (form.allowPlayerPosts !== originalState.value.allowPlayerPosts) return true;
    if (currentPollIntervalSeconds.value !== originalState.value.pollIntervalSeconds) return true;
    return false;
});

watch(
    storyConfig,
    (config) => {
        syncFormWithStory(config);
    },
    { immediate: true },
);

watch(
    () => hasDiscord.value,
    (connected) => {
        if (!connected) {
            guilds.value = [];
            channels.value = [];
            channelBotStatus.value = null;
            guildError.value = '';
            channelError.value = '';
        }
    },
);

watch(
    () => form.guildId,
    (guildId, previousGuildId) => {
        if (!isDM.value || !hasDiscord.value) {
            return;
        }
        if (!guildId) {
            channels.value = [];
            channelBotStatus.value = null;
            channelError.value = '';
            return;
        }
        if (previousGuildId && guildId !== previousGuildId && guildId !== storyGuildId.value) {
            form.channelId = '';
        }
        const preferSaved = guildId === storyGuildId.value;
        const allowDefaults = guildId === defaultGuildId.value && !preferSaved;
        loadChannels(guildId, {
            preferSaved,
            allowDefaults,
            preserveSelection: false,
        });
    },
    { immediate: true },
);

onMounted(() => {
    if (isDM.value && hasDiscord.value) {
        refreshGuilds();
    }
});

function syncFormWithStory(config) {
    form.guildId = config?.guildId || '';
    form.channelId = config?.channelId || '';
    form.allowPlayerPosts = !!config?.allowPlayerPosts;
    form.pollIntervalSeconds = normalizePollIntervalSeconds(
        Number(config?.pollIntervalMs) / 1000,
        15,
    );
}

function normalizePollIntervalSeconds(value, fallbackSeconds = 15) {
    if (value === null || value === undefined || value === '') {
        return fallbackSeconds;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallbackSeconds;
    const rounded = Math.round(numeric);
    if (!Number.isFinite(rounded)) return fallbackSeconds;
    if (rounded < 5) return 5;
    if (rounded > 120) return 120;
    return rounded;
}

function describeDiscordError(err, fallback) {
    const fallbackMessage = fallback || 'Discord request failed.';
    if (!err) return fallbackMessage;
    const rawMessage = typeof err.message === 'string' ? err.message : '';
    const key = rawMessage.toLowerCase();
    switch (key) {
        case 'discord_scope_missing':
            return 'Reconnect your Discord account and grant the "guilds" scope to manage servers.';
        case 'discord_token_error':
        case 'discord_token_refresh_failed':
            return 'We could not refresh your Discord authorization. Please reconnect your Discord account.';
        case 'discord_guilds_fetch_failed':
            return 'Failed to load your Discord servers. Try again in a moment.';
        case 'discord_channels_fetch_failed':
            return 'Failed to load Discord channels for this server.';
        case 'discord_guild_not_found':
            return 'Discord reported that this server is unavailable.';
        default:
            break;
    }
    if (rawMessage && rawMessage !== 'Request failed') {
        return rawMessage;
    }
    if (err.status === 401) {
        return 'Your session expired. Refresh the page and try again.';
    }
    return fallbackMessage;
}

async function refreshGuilds() {
    if (!isDM.value || !hasDiscord.value) {
        guilds.value = [];
        return;
    }
    guildLoading.value = true;
    guildError.value = '';
    try {
        const result = await Discord.guilds();
        const list = Array.isArray(result?.guilds)
            ? result.guilds.filter((guild) => guild && guild.id)
            : [];
        guilds.value = list;
        if (form.guildId && list.some((guild) => guild.id === form.guildId)) {
            // keep current selection
        } else if (storyGuildId.value && list.some((guild) => guild.id === storyGuildId.value)) {
            form.guildId = storyGuildId.value;
        } else if (!form.guildId && defaultGuildId.value && list.some((guild) => guild.id === defaultGuildId.value)) {
            form.guildId = defaultGuildId.value;
        } else if (form.guildId && !list.some((guild) => guild.id === form.guildId)) {
            form.guildId = '';
        }
    } catch (err) {
        guildError.value = describeDiscordError(err, 'Failed to load your Discord servers.');
        guilds.value = [];
    } finally {
        guildLoading.value = false;
    }
}

async function loadChannels(guildId, { preferSaved = false, allowDefaults = false, preserveSelection = true } = {}) {
    if (!guildId || !isDM.value || !hasDiscord.value) {
        channels.value = [];
        channelBotStatus.value = null;
        return;
    }
    const requestId = ++channelRequestToken;
    channelLoading.value = true;
    channelError.value = '';
    try {
        const result = await Discord.guildChannels(guildId);
        if (requestId !== channelRequestToken) {
            return;
        }
        const list = Array.isArray(result?.channels)
            ? result.channels.filter((channel) => channel && channel.id)
            : [];
        channels.value = list;
        channelBotStatus.value = result?.bot || null;

        let nextChannelId = '';
        if (preserveSelection && form.channelId && list.some((channel) => channel.id === form.channelId)) {
            nextChannelId = form.channelId;
        } else if (preferSaved && storyChannelId.value && list.some((channel) => channel.id === storyChannelId.value)) {
            nextChannelId = storyChannelId.value;
        } else if (allowDefaults && defaultChannelId.value && list.some((channel) => channel.id === defaultChannelId.value)) {
            nextChannelId = defaultChannelId.value;
        }
        if (nextChannelId && !list.some((channel) => channel.id === nextChannelId)) {
            nextChannelId = '';
        }
        form.channelId = nextChannelId;
    } catch (err) {
        if (requestId !== channelRequestToken) {
            return;
        }
        channelError.value = describeDiscordError(err, 'Failed to load channels for this server.');
        channels.value = [];
        channelBotStatus.value = null;
    } finally {
        if (requestId === channelRequestToken) {
            channelLoading.value = false;
        }
    }
}

function refreshChannels() {
    if (!form.guildId) return;
    loadChannels(form.guildId, {
        preferSaved: form.guildId === storyGuildId.value,
        allowDefaults: form.guildId === defaultGuildId.value && form.guildId !== storyGuildId.value,
        preserveSelection: true,
    });
}

function formatChannelLabel(channel) {
    if (!channel) return '';
    const prefix = channel.type === 5 ? '📣' : '#';
    const base = channel.name || channel.id;
    const badges = [];
    if (channel.botCanRead === false) {
        badges.push('no read access');
    }
    if (channel.botCanPost === false) {
        badges.push('no post access');
    }
    return badges.length ? `${prefix}${base} (${badges.join(', ')})` : `${prefix}${base}`;
}

async function handleRefreshGame() {
    if (!canRefreshGame.value || refreshingGame.value) return;
    try {
        refreshingGame.value = true;
        await props.onRefreshGame?.();
    } catch (err) {
        console.error(err);
    } finally {
        refreshingGame.value = false;
    }
}

function resetForm() {
    syncFormWithStory(storyConfig.value);
    saveError.value = '';
    saveNotice.value = '';
}

async function saveSettings() {
    if (!isDM.value || !props.game?.id) return;
    if (!isDirty.value) {
        saveNotice.value = 'No changes to save.';
        saveError.value = '';
        return;
    }
    saving.value = true;
    saveError.value = '';
    saveNotice.value = '';
    const payload = {
        guildId: form.guildId || '',
        channelId: form.channelId || '',
        allowPlayerPosts: !!form.allowPlayerPosts,
        pollIntervalMs: normalizePollIntervalSeconds(
            form.pollIntervalSeconds,
            pollIntervalSecondsOriginal.value,
        ) * 1000,
    };
    if (selectedGuild.value) {
        payload.guildName = selectedGuild.value.name || selectedGuild.value.id;
    }
    if (selectedChannel.value) {
        payload.channelName = selectedChannel.value.name || selectedChannel.value.id;
    }
    if (channelBotStatus.value && typeof channelBotStatus.value.present === 'boolean') {
        payload.botInstalled = channelBotStatus.value.present;
    }
    try {
        await StoryLogs.configure(props.game.id, payload);
        saveNotice.value = 'Campaign settings updated.';
        if (typeof props.onRefreshGame === 'function') {
            try {
                await props.onRefreshGame();
            } catch (err) {
                console.error(err);
            }
        }
        if (typeof props.onRefreshStory === 'function') {
            try {
                await props.onRefreshStory();
            } catch (err) {
                console.error(err);
            }
        }
    } catch (err) {
        console.error(err);
        saveError.value = err?.message || 'Failed to update campaign settings.';
    } finally {
        saving.value = false;
    }
}

function openInvite() {
    if (!inviteUrl.value || typeof window === 'undefined') return;
    window.open(inviteUrl.value, '_blank', 'noopener');
}
</script>

<style scoped>
.panel {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

.panel__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
}

.panel__title {
    margin: 0;
    font-size: 1.4rem;
    font-weight: 600;
}

.panel__placeholder {
    margin: 0;
    color: rgba(255, 255, 255, 0.75);
}

.campaign-settings__grid {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

@media (min-width: 980px) {
    .campaign-settings__grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1.5rem;
    }
}

.campaign-settings__card {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.25rem;
    border-radius: 1rem;
    background: rgba(12, 15, 30, 0.6);
    box-shadow: inset 0 0 0 1px rgba(120, 175, 255, 0.12);
}

.campaign-settings__card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
}

.campaign-settings__card-title {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
}

.campaign-settings__summary {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}

.campaign-settings__summary-label {
    display: block;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: rgba(255, 255, 255, 0.55);
}

.campaign-settings__summary-value {
    font-size: 1rem;
    color: rgba(255, 255, 255, 0.9);
}

.campaign-settings__invite {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.campaign-settings__status {
    margin: 0;
    font-size: 0.85rem;
}

.campaign-settings__status--ok {
    color: #86efac;
}

.campaign-settings__status--warn {
    color: #fbbf24;
}

.campaign-settings__notice {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
    margin: 0;
    font-size: 0.95rem;
    color: rgba(255, 255, 255, 0.85);
}

.campaign-settings__field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.campaign-settings__field-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
}

.campaign-settings__label {
    font-size: 0.9rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.75);
}

select,
input[type='number'] {
    width: 100%;
    padding: 0.55rem 0.75rem;
    border-radius: 0.7rem;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(10, 15, 30, 0.6);
    color: rgba(255, 255, 255, 0.9);
}

select:disabled,
input[type='number']:disabled {
    opacity: 0.6;
}

.campaign-settings__checkbox {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    font-size: 0.95rem;
    color: rgba(255, 255, 255, 0.85);
}

.campaign-settings__field--inline {
    margin-top: 0.25rem;
}

.campaign-settings__hint {
    margin: 0;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.65);
}

.campaign-settings__warnings {
    margin: 0;
    padding-left: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
    color: #facc15;
}

.campaign-settings__error {
    margin: 0;
    font-size: 0.85rem;
    color: #ff9d9d;
}

.campaign-settings__success {
    margin: 0;
    font-size: 0.85rem;
    color: #86efac;
}

.campaign-settings__actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
}

.button--ghost {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.85);
    box-shadow: none;
}
</style>
