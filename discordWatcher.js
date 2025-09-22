/* eslint-env node */
import process from 'process';

const DISCORD_API_BASE = 'https://discord.com/api/v10';

class DiscordWatcherError extends Error {
    constructor(message, { retryAfter, status, fatal } = {}) {
        super(message);
        this.name = 'DiscordWatcherError';
        this.retryAfter = typeof retryAfter === 'number' && Number.isFinite(retryAfter) ? retryAfter : null;
        this.status = status ?? null;
        this.fatal = !!fatal;
    }
}

function toNumber(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function buildAvatarUrl(author) {
    if (!author || !author.id) return null;
    const hash = author.avatar;
    if (hash) {
        const isGif = typeof hash === 'string' && hash.startsWith('a_');
        const ext = isGif ? 'gif' : 'png';
        return `https://cdn.discordapp.com/avatars/${author.id}/${hash}.${ext}?size=128`;
    }
    let fallbackIndex = 0;
    if (author.discriminator && author.discriminator !== '0') {
        fallbackIndex = Number(author.discriminator) % 6;
    } else if (author.id) {
        try {
            fallbackIndex = Number(BigInt(author.id) % 6n);
        } catch {
            fallbackIndex = 0;
        }
    }
    return `https://cdn.discordapp.com/embed/avatars/${fallbackIndex}.png`;
}

function replaceMentions(content, raw) {
    if (typeof content !== 'string' || !content) return '';
    let text = content;

    if (Array.isArray(raw?.mentions)) {
        for (const mention of raw.mentions) {
            if (!mention?.id) continue;
            const name = mention.global_name || mention.username || mention.id;
            const pattern = new RegExp(`<@!?${mention.id}>`, 'g');
            text = text.replace(pattern, `@${name}`);
        }
    }

    if (Array.isArray(raw?.mention_channels)) {
        for (const channel of raw.mention_channels) {
            if (!channel?.id) continue;
            const label = channel.name ? `#${channel.name}` : `#${channel.id}`;
            const pattern = new RegExp(`<#${channel.id}>`, 'g');
            text = text.replace(pattern, label);
        }
    }

    return text;
}

function normalizeMessage(raw, channel) {
    if (!raw || typeof raw !== 'object') return null;
    const author = raw.author || {};
    const displayName = raw.member?.nick || author.global_name || author.username || 'Unknown';
    const attachments = Array.isArray(raw.attachments)
        ? raw.attachments.map((att) => ({
            id: att.id,
            url: att.url,
            proxyUrl: att.proxy_url ?? null,
            name: att.filename || att.id,
            contentType: att.content_type ?? null,
            size: att.size ?? null,
        }))
        : [];
    const createdAt = raw.timestamp || null;
    const editedAt = raw.edited_timestamp || null;
    const guildId = raw.guild_id || channel?.guildId || null;

    return {
        id: raw.id,
        channelId: raw.channel_id || channel?.id || null,
        guildId,
        author: {
            id: author.id || null,
            username: author.username || null,
            globalName: author.global_name || null,
            discriminator: author.discriminator || null,
            bot: !!author.bot,
            displayName,
            avatarUrl: buildAvatarUrl(author),
        },
        content: replaceMentions(raw.content || '', raw),
        rawContent: raw.content || '',
        createdAt,
        editedAt,
        attachments,
        jumpLink: guildId && raw.channel_id && raw.id
            ? `https://discord.com/channels/${guildId}/${raw.channel_id}/${raw.id}`
            : null,
    };
}

async function discordRequest(path, token, { signal } = {}) {
    if (!token) throw new DiscordWatcherError('Missing Discord bot token', { fatal: true });
    const url = `${DISCORD_API_BASE}${path}`;
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            Authorization: `Bot ${token}`,
            'User-Agent': 'jack-endex/discord-watcher (+https://example.com)',
            Accept: 'application/json',
        },
        signal,
    });

    if (res.status === 429) {
        let retryAfter = 1000;
        try {
            const body = await res.json();
            if (body && typeof body.retry_after === 'number') {
                retryAfter = Math.max(1000, Math.ceil(body.retry_after * 1000));
            }
        } catch {
            // ignore
        }
        throw new DiscordWatcherError('Rate limited by Discord (429).', { retryAfter, status: 429 });
    }
    if (res.status === 401) {
        throw new DiscordWatcherError('Unauthorized: check DISCORD_BOT_TOKEN.', { status: 401, fatal: true });
    }
    if (res.status === 403) {
        throw new DiscordWatcherError('Forbidden: bot lacks access to the channel.', { status: 403 });
    }
    if (!res.ok) {
        let message = `Discord API error ${res.status}`;
        try {
            const text = await res.text();
            if (text) message += `: ${text.slice(0, 200)}`;
        } catch {
            // ignore
        }
        throw new DiscordWatcherError(message, { status: res.status });
    }
    return res.json();
}

export function createDiscordWatcher({
    token,
    guildId,
    channelId,
    pollIntervalMs = 15_000,
    maxMessages = 50,
} = {}) {
    const normalizedPoll = Math.max(5_000, Math.min(120_000, toNumber(pollIntervalMs, 15_000)));
    const limit = Math.max(1, Math.min(100, Math.floor(toNumber(maxMessages, 50))));
    const enabled = Boolean(token && channelId);
    const scopeGuild = guildId ? `:${guildId}` : '';
    const scope = `${channelId || 'unknown'}${scopeGuild}`;
    const logPrefix = `[discord-watcher:${scope}]`;
    const debug = (...args) => console.log(logPrefix, ...args);
    const warn = (...args) => console.warn(logPrefix, ...args);
    const error = (...args) => console.error(logPrefix, ...args);

    const state = {
        enabled,
        phase: enabled ? 'idle' : 'disabled',
        error: null,
        lastErrorAt: null,
        lastAttemptAt: null,
        lastSyncAt: null,
        readyAt: null,
        channel: null,
        pollIntervalMs: normalizedPoll,
    };

    const messages = [];
    let started = false;
    let timer = null;
    let inFlight = false;
    let stopped = false;
    const listeners = new Set();

    function notify() {
        if (listeners.size === 0) return;
        const payload = { status: getStatus(), messages: getMessages() };
        for (const listener of listeners) {
            try {
                listener(payload);
            } catch (err) {
                warn('listener error', err);
            }
        }
    }

    function setPhase(phase) {
        if (state.phase !== phase) {
            state.phase = phase;
            if (phase === 'ready' || phase === 'connecting') {
                state.error = null;
            }
            debug('phase changed to', phase);
        }
        notify();
    }

    function setError(message) {
        state.phase = 'error';
        state.error = message;
        state.lastErrorAt = new Date().toISOString();
        error('entering error state:', message);
        notify();
    }

    function scheduleNext(delayMs = state.pollIntervalMs) {
        if (stopped) return;
        clearTimeout(timer);
        debug('scheduling next sync in', Math.max(0, delayMs), 'ms');
        timer = setTimeout(async () => {
            const nextDelay = await syncOnce();
            scheduleNext(nextDelay);
        }, Math.max(0, delayMs));
    }

    async function ensureChannelInfo() {
        if (state.channel) return;
        const data = await discordRequest(`/channels/${channelId}`, token);
        if (guildId && data.guild_id && data.guild_id !== guildId) {
            throw new DiscordWatcherError('Configured guild does not match channel guild.', { fatal: true });
        }
        state.channel = {
            id: data.id,
            name: data.name || data.id,
            topic: data.topic || null,
            guildId: data.guild_id || guildId || null,
            url: data.guild_id ? `https://discord.com/channels/${data.guild_id}/${data.id}` : null,
        };
        if (!state.readyAt) state.readyAt = new Date().toISOString();
        debug('channel info loaded', {
            channelId: state.channel.id,
            guildId: state.channel.guildId,
            name: state.channel.name,
        });
    }

    async function syncOnce() {
        if (!enabled || stopped) return state.pollIntervalMs;
        if (inFlight) return state.pollIntervalMs;
        inFlight = true;
        state.lastAttemptAt = new Date().toISOString();
        try {
            debug('starting sync attempt', { lastSyncAt: state.lastSyncAt });
            setPhase(state.channel ? 'ready' : 'connecting');
            await ensureChannelInfo();
            const raw = await discordRequest(`/channels/${channelId}/messages?limit=${limit}`, token);
            const normalized = Array.isArray(raw)
                ? raw
                    .map((entry) => normalizeMessage(entry, state.channel))
                    .filter(Boolean)
                    .sort((a, b) => {
                        const aTime = Date.parse(a.createdAt || '') || 0;
                        const bTime = Date.parse(b.createdAt || '') || 0;
                        return aTime - bTime;
                    })
                : [];
            messages.splice(0, messages.length, ...normalized.slice(-limit));
            state.lastSyncAt = new Date().toISOString();
            if (!state.readyAt) state.readyAt = state.lastSyncAt;
            setPhase('ready');
            debug('sync completed', {
                messageCount: messages.length,
                pollIntervalMs: state.pollIntervalMs,
            });
            notify();
            return state.pollIntervalMs;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to sync Discord channel.';
            setError(message);
            const retry = err instanceof DiscordWatcherError && err.retryAfter
                ? err.retryAfter
                : Math.min(state.pollIntervalMs * 2, 120_000);
            if (err instanceof DiscordWatcherError && err.fatal) {
                error('fatal sync error, will retry after', retry, 'ms:', err);
            } else {
                warn('sync error, will retry after', retry, 'ms:', err);
            }
            return retry;
        } finally {
            inFlight = false;
        }
    }

    function start() {
        if (started) {
            debug('start requested but watcher already running');
            return;
        }
        if (!enabled) {
            warn('start requested but watcher is disabled due to missing configuration');
            started = true;
            return;
        }
        started = true;
        stopped = false;
        debug('starting watcher loop', {
            pollIntervalMs: state.pollIntervalMs,
            limit,
        });
        setPhase('connecting');
        scheduleNext(0);
    }

    function stop() {
        stopped = true;
        clearTimeout(timer);
        timer = null;
        debug('stop requested; timer cleared');
    }

    function getMessages() {
        return messages.map((msg) => ({ ...msg }));
    }

    function getStatus() {
        return { ...state, channel: state.channel ? { ...state.channel } : null };
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        debug('listener subscribed; total listeners:', listeners.size);
        try {
            listener({ status: getStatus(), messages: getMessages() });
        } catch (err) {
            warn('listener bootstrap error', err);
        }
        return () => {
            listeners.delete(listener);
            debug('listener unsubscribed; remaining listeners:', listeners.size);
        };
    }

    debug('initialized', {
        enabled,
        pollIntervalMs: normalizedPoll,
        maxMessages: limit,
    });

    return {
        enabled,
        start,
        stop,
        getMessages,
        getStatus,
        subscribe,
        forceSync: () => syncOnce(),
    };
}

export function createWatcherFromEnv(env = process.env) {
    return createDiscordWatcher({
        token: env.DISCORD_BOT_TOKEN
            || env.DISCORD_PRIMARY_BOT_TOKEN
            || env.DISCORD_DEFAULT_BOT_TOKEN
            || env.BOT_TOKEN,
        guildId: env.DISCORD_GUILD_ID
            || env.DISCORD_PRIMARY_GUILD_ID
            || env.DISCORD_SERVER_ID,
        channelId: env.DISCORD_CHANNEL_ID || env.DISCORD_PRIMARY_CHANNEL_ID,
        pollIntervalMs: env.DISCORD_POLL_INTERVAL_MS,
        maxMessages: env.DISCORD_MAX_MESSAGES,
    });
}

export { DiscordWatcherError };
