import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import { loadEnv, envString, envNumber } from '../config/env.js';
import mongoose from '../lib/mongoose.js';
import User from '../models/User.js';
import {
    searchDemons,
    findDemonBySlug,
    findClosestDemon,
    summarizeDemon,
    buildDemonDetailString,
} from '../services/demons.js';

const API_BASE = 'https://discord.com/api/v10';
const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

await loadEnv({ root: path.resolve(__dirname, '..', '..') });

const token = envString('DISCORD_PRIMARY_BOT_TOKEN')
    || envString('DISCORD_DEFAULT_BOT_TOKEN')
    || envString('DISCORD_BOT_TOKEN')
    || envString('BOT_TOKEN');
const uri = envString('MONGODB_URI');
const dbName = envString('MONGODB_DB_NAME');
const applicationId = envString('DISCORD_APPLICATION_ID');
const commandGuildId = envString('DISCORD_COMMAND_GUILD_ID')
    || envString('DISCORD_PRIMARY_GUILD_ID')
    || envString('DISCORD_GUILD_ID')
    || envString('DISCORD_SERVER_ID');
const DB_CONNECT_MAX_ATTEMPTS = Math.max(1, envNumber('BOT_MONGODB_CONNECT_MAX_ATTEMPTS', 5) || 5);
const DB_CONNECT_RETRY_DELAY_MS = Math.max(500, envNumber('BOT_MONGODB_CONNECT_RETRY_MS', 2000) || 2000);
const COMMAND_REGISTER_MAX_ATTEMPTS = Math.max(1, envNumber('BOT_COMMAND_REGISTER_MAX_ATTEMPTS', 3) || 3);
const COMMAND_REGISTER_RETRY_DELAY_MS = Math.max(
    1_000,
    envNumber('BOT_COMMAND_REGISTER_RETRY_MS', 2_000) || 2_000,
);

if (!token) {
    console.error('Missing bot token. Set DISCORD_PRIMARY_BOT_TOKEN or DISCORD_BOT_TOKEN in your .env file.');
    process.exit(1);
}
if (!uri) {
    console.error('Missing MONGODB_URI environment variable.');
    process.exit(1);
}

async function delay(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectToDatabaseWithRetry(
    connectionUri,
    options = {},
    { attempts = DB_CONNECT_MAX_ATTEMPTS, delayMs = DB_CONNECT_RETRY_DELAY_MS } = {},
) {
    const totalAttempts = Math.max(1, Math.floor(attempts));
    const baseDelay = Math.max(500, Math.floor(delayMs));
    let lastError = null;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
        try {
            await mongoose.connect(connectionUri, options);
            console.log(`[bot] Connected to MongoDB (attempt ${attempt}/${totalAttempts}).`);
            return;
        } catch (err) {
            lastError = err;
            console.error(`[bot] MongoDB connection attempt ${attempt} failed:`, err);
            if (attempt >= totalAttempts) break;
            const waitMs = Math.min(baseDelay * 2 ** (attempt - 1), 30_000);
            console.log(`[bot] Retrying MongoDB connection in ${waitMs}ms…`);
            await delay(waitMs);
        }
    }

    throw lastError ?? new Error('Bot failed to connect to MongoDB.');
}

try {
    await connectToDatabaseWithRetry(uri, { dbName: dbName || undefined });
    await registerSlashCommandsWithRetry().catch((err) => {
        console.error('[bot] Slash command registration failed:', err);
        throw err;
    });
    console.log('[bot] Connected to MongoDB. Starting gateway connection…');
} catch (err) {
    console.error('[bot] Failed to prepare bot. Exiting.', err);
    process.exit(1);
}

const ABILITY_KEYS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const RESIST_KEYS = [
    ['weak', 'Weak'],
    ['resist', 'Resist'],
    ['block', 'Block'],
    ['drain', 'Drain'],
    ['reflect', 'Reflect'],
];

const RESISTANCE_ALIAS_MAP = {
    weak: ['weak', 'weaks'],
    resist: ['resist', 'resists'],
    block: ['block', 'blocks', 'null', 'nullify', 'nullifies'],
    drain: ['drain', 'drains', 'absorb', 'absorbs'],
    reflect: ['reflect', 'reflects'],
};

const COMMAND_DEFINITIONS = [
    {
        name: 'demonLookup',
        description: 'Look up codex information for a demon.',
        type: 1,
        options: [
            {
                name: 'name',
                description: 'Name of the demon to search for.',
                type: 3,
                required: true,
            },
        ],
    },
    {
        name: 'link',
        description: 'Link your Discord account to your Jack Endex profile.',
        type: 1,
        options: [
            {
                name: 'username',
                description: 'Your Jack Endex username.',
                type: 3,
                required: true,
            },
        ],
    },
];

function getResistanceValues(demon, key) {
    if (!demon) return [];
    const aliases = RESISTANCE_ALIAS_MAP[key] || [key];
    const values = new Set();
    for (const alias of aliases) {
        const list = demon.resistances?.[alias];
        if (Array.isArray(list)) {
            for (const entry of list) {
                if (!entry) continue;
                values.add(entry);
            }
        } else if (typeof list === 'string' && list.trim()) {
            values.add(list.trim());
        }
        const fallback = demon[alias];
        if (Array.isArray(fallback)) {
            for (const entry of fallback) {
                if (!entry) continue;
                values.add(entry);
            }
        } else if (typeof fallback === 'string' && fallback.trim()) {
            values.add(fallback.trim());
        }
    }
    return Array.from(values);
}

function truncate(text, max = 1024) {
    if (!text) return '';
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getOptionValue(interaction, optionName) {
    const options = interaction?.data?.options;
    if (!Array.isArray(options)) return null;
    const option = options.find((opt) => opt?.name === optionName);
    return option?.value ?? null;
}

function getDiscordUserId(interaction) {
    return interaction?.member?.user?.id
        || interaction?.user?.id
        || null;
}

async function discordFetch(endpoint, { headers = {}, ...options } = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bot ${token}`,
            ...headers,
        },
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        const error = new Error(
            `Discord API request failed with ${response.status} ${response.statusText}: ${text}`,
        );
        error.status = response.status;
        error.statusText = response.statusText;
        error.body = text;
        throw error;
    }
    return response;
}

async function registerSlashCommands() {
    if (!applicationId) {
        console.warn('[bot] Missing DISCORD_APPLICATION_ID; skipping command registration.');
        return;
    }
    const scopeDescription = commandGuildId ? `guild ${commandGuildId}` : 'global';
    const route = commandGuildId
        ? `/applications/${applicationId}/guilds/${commandGuildId}/commands`
        : `/applications/${applicationId}/commands`;
    const response = await discordFetch(route, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(COMMAND_DEFINITIONS),
    });
    let payload;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }
    const count = Array.isArray(payload) ? payload.length : COMMAND_DEFINITIONS.length;
    console.log(`[bot] Registered ${count} slash command(s) for ${scopeDescription}.`);
}

async function registerSlashCommandsWithRetry({
    attempts = COMMAND_REGISTER_MAX_ATTEMPTS,
    delayMs = COMMAND_REGISTER_RETRY_DELAY_MS,
} = {}) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            await registerSlashCommands();
            return;
        } catch (err) {
            if (attempt >= attempts) {
                throw err;
            }
            const waitMs = Math.min(delayMs * 2 ** (attempt - 1), 30_000);
            console.warn(
                `[bot] Failed to register slash commands (attempt ${attempt}/${attempts}). Retrying in ${waitMs}ms…`,
            );
            await delay(waitMs);
        }
    }
}

function formatDemonResponse(demon) {
    const lines = [];
    const summary = buildDemonDetailString(demon);
    lines.push(`**${demon.name}**${summary ? ` · ${summary}` : ''}`);
    if (demon.description) {
        lines.push(truncate(demon.description, 400));
    }
    const stats = ABILITY_KEYS.map((key) => `${key} ${demon.stats?.[key] ?? 0}`).join(' · ');
    lines.push(`Stats: ${stats}`);
    const resistParts = RESIST_KEYS.map(([key, label]) => {
        const values = getResistanceValues(demon, key);
        return `${label}: ${values.length ? values.join(', ') : '—'}`;
    });
    lines.push(resistParts.join(' · '));
    if (Array.isArray(demon.skills) && demon.skills.length > 0) {
        const skills = demon.skills
            .slice(0, 6)
            .map((skill) => {
                const suffix = [];
                if (skill.element) suffix.push(skill.element);
                if (skill.cost) suffix.push(`${skill.cost}`);
                const meta = suffix.length > 0 ? ` (${suffix.join(' · ')})` : '';
                return `• ${skill.name}${meta}`;
            });
        if (demon.skills.length > skills.length) {
            skills.push(`…and ${demon.skills.length - skills.length} more skills`);
        }
        lines.push(skills.join('\n'));
    }
    if (demon.image) {
        lines.push(demon.image);
    }
    return lines.join('\n');
}

async function resolveDemon(term) {
    const normalized = term.trim();
    if (!normalized) return null;
    const slug = normalized.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    let demon = slug ? await findDemonBySlug(slug) : null;
    if (!demon) {
        const [hit] = await searchDemons(normalized, { limit: 1 });
        if (hit) demon = hit;
    }
    return demon ? summarizeDemon(demon) : null;
}

async function respond(interaction, payload) {
    const url = `${API_BASE}/interactions/${interaction.id}/${interaction.token}/callback`;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 4, data: { ...payload, flags: 64 } }),
    });
}

async function handleDemonLookupCommand(interaction) {
    const term = getOptionValue(interaction, 'name');
    if (!term || !String(term).trim()) {
        await respond(interaction, { content: 'Provide a demon name to look up.' });
        return;
    }
    const query = String(term).trim();
    try {
        const demon = await resolveDemon(query);
        if (demon) {
            const message = formatDemonResponse(demon);
            await respond(interaction, { content: message });
            return;
        }
        const suggestion = await findClosestDemon(query);
        if (suggestion) {
            await respond(interaction, {
                content: `No exact match. Did you mean **${suggestion.name}**? Try \`/demonLookup ${suggestion.name}\`.`,
            });
        } else {
            await respond(interaction, { content: `No demon found matching **${query}**.` });
        }
    } catch (err) {
        console.error('[bot] Failed to process demon lookup:', err);
        await respond(interaction, { content: 'Something went wrong looking up that demon.' });
    }
}

async function handleLinkCommand(interaction) {
    const discordUserId = getDiscordUserId(interaction);
    if (!discordUserId) {
        await respond(interaction, { content: 'Unable to determine your Discord user ID.' });
        return;
    }
    const usernameInput = getOptionValue(interaction, 'username');
    const normalized = typeof usernameInput === 'string' ? usernameInput.trim() : '';
    if (!normalized) {
        await respond(interaction, { content: 'Provide the Jack Endex username you want to link.' });
        return;
    }
    try {
        const user = await User.findOne({
            username: { $regex: `^${escapeRegex(normalized)}$`, $options: 'i' },
        }).exec();
        if (!user) {
            await respond(interaction, {
                content: `No Jack Endex account found for **${normalized}**. Check the spelling and try again.`,
            });
            return;
        }
        if (user.discordId && user.discordId !== discordUserId) {
            await respond(interaction, {
                content: 'That Jack Endex account is already linked to a different Discord user.',
            });
            return;
        }
        const existingLink = await User.findOne({
            _id: { $ne: user._id },
            discordId: discordUserId,
        }).exec();
        if (existingLink) {
            await respond(interaction, {
                content: `Your Discord account is already linked to **${existingLink.username}**.`,
            });
            return;
        }
        if (user.discordId === discordUserId) {
            await respond(interaction, {
                content: `Your Discord account is already linked to **${user.username}**.`,
            });
            return;
        }
        user.discordId = discordUserId;
        await user.save();
        await respond(interaction, {
            content: `Success! Your Discord account is now linked to **${user.username}**.`,
        });
    } catch (err) {
        console.error('[bot] Failed to link Discord account:', err);
        await respond(interaction, {
            content: 'Something went wrong while linking your account. Please try again later.',
        });
    }
}

async function handleInteraction(interaction) {
    if (interaction.type !== 2) return; // application command
    const commandName = interaction.data?.name;
    if (!commandName) return;
    if (commandName === 'demonLookup') {
        await handleDemonLookupCommand(interaction);
        return;
    }
    if (commandName === 'link') {
        await handleLinkCommand(interaction);
        return;
    }
}

let shuttingDown = false;
let sessionId = null;
let lastSequence = null;
let resumeGatewayUrl = null;

function startGateway() {
    let ws;
    let heartbeatInterval = null;
    let heartbeatTimeout = null;
    let heartbeatIntervalMs = 0;
    let awaitingHeartbeatAck = false;
    let reconnectTimer = null;
    let reconnectAttempts = 0;

    function clearHeartbeat() {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
        if (heartbeatTimeout) {
            clearTimeout(heartbeatTimeout);
            heartbeatTimeout = null;
        }
        awaitingHeartbeatAck = false;
        heartbeatIntervalMs = 0;
    }

    function cleanup() {
        clearHeartbeat();
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    }

    function scheduleReconnect(baseDelayMs = 1_000) {
        if (shuttingDown) return;
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
        }
        const delay = Math.min(baseDelayMs * 2 ** reconnectAttempts, 30_000);
        console.warn(`[bot] Reconnecting in ${delay}ms…`);
        reconnectTimer = setTimeout(() => {
            reconnectAttempts += 1;
            connect();
        }, delay);
    }

    function sendHeartbeat() {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (awaitingHeartbeatAck) {
            console.warn('[bot] Missed heartbeat acknowledgement. Terminating connection…');
            ws.terminate();
            return;
        }
        ws.send(JSON.stringify({ op: 1, d: lastSequence }));
        awaitingHeartbeatAck = true;
        if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
        heartbeatTimeout = setTimeout(() => {
            if (awaitingHeartbeatAck && ws?.readyState === WebSocket.OPEN) {
                console.warn('[bot] Heartbeat acknowledgement timeout. Terminating connection…');
                ws.terminate();
            }
        }, Math.max(1_000, Math.floor(heartbeatIntervalMs * 0.5) || 5_000));
    }

    function connect() {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        const gatewayUrl = resumeGatewayUrl || GATEWAY_URL;
        ws = new WebSocket(gatewayUrl);

        ws.on('open', () => {
            reconnectAttempts = 0;
        });

        ws.on('message', async (data) => {
            let payload;
            try {
                payload = JSON.parse(data.toString());
            } catch (err) {
                console.error('[bot] Failed to parse gateway payload:', err);
                return;
            }
            const { op, t, d, s } = payload;
            if (s !== null && s !== undefined) {
                lastSequence = s;
            }
            switch (op) {
                case 0: {
                    if (t === 'READY') {
                        sessionId = d.session_id;
                        resumeGatewayUrl = d.resume_gateway_url || GATEWAY_URL;
                        console.log(`[bot] Logged in as ${d.user?.username ?? 'bot'} (${sessionId}).`);
                    } else if (t === 'RESUMED') {
                        console.log('[bot] Successfully resumed previous gateway session.');
                    } else if (t === 'INTERACTION_CREATE') {
                        try {
                            await handleInteraction(d);
                        } catch (err) {
                            console.error('[bot] Unexpected error handling interaction:', err);
                        }
                    }
                    break;
                }
                case 1: { // Heartbeat request
                    sendHeartbeat();
                    break;
                }
                case 7: { // Reconnect
                    console.log('[bot] Gateway requested reconnect.');
                    clearHeartbeat();
                    ws.close(4000, 'Reconnect requested');
                    break;
                }
                case 9: { // Invalid session
                    const resumable = Boolean(d);
                    if (!resumable) {
                        sessionId = null;
                        resumeGatewayUrl = null;
                        lastSequence = null;
                    }
                    console.warn(`[bot] Invalid session received (resumable=${resumable}).`);
                    clearHeartbeat();
                    setTimeout(() => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.close(4001, 'Invalid session');
                        }
                    }, Math.floor(Math.random() * 4_000) + 1_000);
                    break;
                }
                case 10: { // Hello
                    clearHeartbeat();
                    heartbeatIntervalMs = Math.max(1_000, Math.floor(d.heartbeat_interval));
                    heartbeatInterval = setInterval(() => {
                        sendHeartbeat();
                    }, heartbeatIntervalMs);
                    sendHeartbeat();
                    if (sessionId && lastSequence !== null) {
                        ws.send(JSON.stringify({
                            op: 6,
                            d: {
                                token,
                                session_id: sessionId,
                                seq: lastSequence,
                            },
                        }));
                    } else {
                        ws.send(JSON.stringify({
                            op: 2,
                            d: {
                                token,
                                intents: 0,
                                properties: {
                                    os: process.platform,
                                    browser: 'jack-endex',
                                    device: 'jack-endex',
                                },
                            },
                        }));
                    }
                    break;
                }
                case 11: { // Heartbeat ACK
                    awaitingHeartbeatAck = false;
                    if (heartbeatTimeout) {
                        clearTimeout(heartbeatTimeout);
                        heartbeatTimeout = null;
                    }
                    break;
                }
                default:
                    break;
            }
        });

        ws.on('close', (code) => {
            cleanup();
            if (shuttingDown) return;
            console.warn(`[bot] Gateway closed (${code}).`);
            scheduleReconnect(1_000);
        });

        ws.on('error', (err) => {
            console.error('[bot] Gateway error:', err);
            if (ws.readyState === WebSocket.OPEN) {
                ws.close(1011, 'Gateway error');
            }
        });
    }

    connect();

    return () => {
        shuttingDown = true;
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        cleanup();
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            try {
                ws.close(1001, 'Bot shutting down');
            } catch (err) {
                console.error('[bot] Error closing gateway during shutdown:', err);
            }
        }
        ws = null;
    };
}

const stopGateway = startGateway();

async function gracefulShutdown(signal) {
    console.log(`\n[bot] Received ${signal}. Shutting down…`);
    shuttingDown = true;
    if (typeof stopGateway === 'function') {
        try {
            await stopGateway();
        } catch (err) {
            console.error('[bot] Error stopping gateway:', err);
        }
    }
    try {
        await mongoose.disconnect();
    } catch (err) {
        console.error('[bot] Error during shutdown:', err);
    }
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
    console.error('[bot] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
    console.error('[bot] Unhandled rejection:', reason);
});
