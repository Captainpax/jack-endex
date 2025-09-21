/* eslint-env node */
/* global process */
import express from 'express';
import session from 'express-session';
import { v4 as uuid } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import personas from './routes/personas.routes.js';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { createDiscordWatcher } from './discordWatcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loadedEnvKeys = new Set();
const storyWatchers = new Map();

/**
 * Read the bot token configured for Discord synchronization.
 * Falls back to legacy BOT_TOKEN if present.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
function getDiscordBotToken(env = process.env) {
    const token = env.DISCORD_BOT_TOKEN || env.BOT_TOKEN;
    return typeof token === 'string' && token.trim() ? token.trim() : null;
}

function parseEnvFile(content) {
    const entries = new Map();
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line;
        const eqIndex = withoutExport.indexOf('=');
        if (eqIndex === -1) continue;
        const key = withoutExport.slice(0, eqIndex).trim();
        if (!key) continue;
        let value = withoutExport.slice(eqIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        } else {
            const commentIndex = value.indexOf(' #');
            if (commentIndex !== -1) {
                value = value.slice(0, commentIndex).trimEnd();
            }
        }
        entries.set(key, value);
    }
    return entries;
}

function applyEnv(entries, { overrideLoaded = false } = {}) {
    for (const [key, value] of entries) {
        const hasExisting = Object.prototype.hasOwnProperty.call(process.env, key);
        if (!hasExisting || (overrideLoaded && loadedEnvKeys.has(key))) {
            process.env[key] = value;
            loadedEnvKeys.add(key);
        }
    }
}

async function loadEnvFiles() {
    const files = ['.env', '.env.local'];
    for (const file of files) {
        const filepath = path.join(__dirname, file);
        try {
            const content = await fs.readFile(filepath, 'utf8');
            const entries = parseEnvFile(content.replace(/^\uFEFF/, ''));
            applyEnv(entries, { overrideLoaded: file.endsWith('.local') });
        } catch (err) {
            if (err && err.code !== 'ENOENT') {
                console.warn(`Failed to read ${file}:`, err);
            }
        }
    }
}

await loadEnvFiles();
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const ITEMS_PATH = path.join(__dirname, 'data', 'premade-items.json');
const INDEX_CANDIDATES = [
    path.join(__dirname, 'dist', 'index.html'),
    path.join(__dirname, 'public', 'index.html'),
    path.join(__dirname, 'index.html'),
];
let SPA_INDEX = null;
for (const candidate of INDEX_CANDIDATES) {
    try {
        await fs.access(candidate);
        SPA_INDEX = candidate;
        break;
    } catch {
        // ignore missing candidates
    }
}

// --- game helpers ---
function ensureGameShape(game) {
    if (!game || typeof game !== 'object') return null;
    if (Array.isArray(game.players)) {
        game.players = game.players
            .map((p) => ensurePlayerShape(p))
            .filter(Boolean);
    } else {
        game.players = [];
    }
    if (!game.name) game.name = 'Untitled Game';
    if (!game.items || typeof game.items !== 'object') game.items = { custom: [] };
    if (!Array.isArray(game.items.custom)) game.items.custom = [];
    if (!game.gear || typeof game.gear !== 'object') game.gear = { custom: [] };
    if (!Array.isArray(game.gear.custom)) game.gear.custom = [];
    if (!Array.isArray(game.demons)) game.demons = [];
    if (!game.demonPool || typeof game.demonPool !== 'object') game.demonPool = { max: 0, used: 0 };
    game.demonPool.max = Number(game.demonPool.max) || 0;
    game.demonPool.used = Number(game.demonPool.used) || 0;
    if (!game.permissions || typeof game.permissions !== 'object') {
        game.permissions = { canEditStats: false, canEditItems: false, canEditGear: false, canEditDemons: false };
    } else {
        game.permissions = {
            canEditStats: !!game.permissions.canEditStats,
            canEditItems: !!game.permissions.canEditItems,
            canEditGear: !!game.permissions.canEditGear,
            canEditDemons: !!game.permissions.canEditDemons,
        };
    }
    if (!Array.isArray(game.invites)) game.invites = [];
    game.story = ensureStoryConfig(game);
    return game;
}

function ensureInventoryItem(item) {
    if (!item || typeof item !== 'object') return null;
    const normalized = {
        id: typeof item.id === 'string' && item.id ? item.id : uuid(),
        name: sanitizeText(item.name),
        type: sanitizeText(item.type),
        desc: sanitizeText(item.desc),
        amount: normalizeCount(item.amount, 0),
    };
    return normalized;
}

const GEAR_SLOTS = ['weapon', 'armor', 'accessory'];

function ensureGearEntry(item) {
    if (!item || typeof item !== 'object') return null;
    const name = sanitizeText(item.name).trim();
    if (!name) return null;
    return {
        id: typeof item.id === 'string' && item.id ? item.id : uuid(),
        name,
        type: sanitizeText(item.type),
        desc: sanitizeText(item.desc),
    };
}

function ensureGearState(player) {
    const raw = player && typeof player.gear === 'object' ? player.gear : {};
    const bagMap = new Map();

    function upsert(entry) {
        const normalized = ensureGearEntry(entry);
        if (!normalized) return null;
        const existing = bagMap.get(normalized.id);
        if (existing) {
            bagMap.set(normalized.id, { ...existing, ...normalized });
        } else {
            bagMap.set(normalized.id, normalized);
        }
        return normalized.id;
    }

    const inputBag = Array.isArray(raw.bag) ? raw.bag : [];
    for (const entry of inputBag) upsert(entry);

    const normalizedSlots = {};
    const rawSlots = raw && typeof raw.slots === 'object' ? raw.slots : {};

    for (const slot of GEAR_SLOTS) {
        let itemId = null;
        const slotSource = rawSlots?.[slot];
        if (slotSource && typeof slotSource === 'object') {
            if (typeof slotSource.itemId === 'string' && slotSource.itemId) {
                if (bagMap.has(slotSource.itemId)) {
                    itemId = slotSource.itemId;
                } else if (slotSource.item && typeof slotSource.item === 'object') {
                    itemId = upsert({ ...slotSource.item, id: slotSource.itemId });
                }
            } else {
                const inserted = upsert(slotSource);
                if (inserted) itemId = inserted;
            }
        }

        if (!itemId) {
            const legacyEntry = raw?.[slot];
            const inserted = upsert(legacyEntry);
            if (inserted) itemId = inserted;
        }

        normalizedSlots[slot] = itemId ? { itemId } : null;
    }

    const bag = Array.from(bagMap.values());
    return { bag, slots: normalizedSlots };
}

function ensurePlayerShape(player) {
    if (!player || typeof player !== 'object') return null;
    const out = { ...player };
    out.role = typeof out.role === 'string' ? out.role : 'player';
    if (out.character === undefined) out.character = null;
    if (Array.isArray(out.inventory)) {
        out.inventory = out.inventory.map((item) => ensureInventoryItem(item)).filter(Boolean);
    } else {
        out.inventory = [];
    }
    out.gear = ensureGearState(out);
    return out;
}

function getGame(db, id) {
    const gameId = parseUUID(id);
    if (!gameId) return null;
    const game = (db.games || []).find((g) => g && g.id === gameId);
    return ensureGameShape(game);
}

function saveGame(db, updated) {
    const idx = (db.games || []).findIndex((g) => g && g.id === updated.id);
    if (idx === -1) return;
    db.games[idx] = updated;
}

function isDM(game, userId) {
    return game.dmId === userId;
}

function isMember(game, userId) {
    if (!userId) return false;
    if (isDM(game, userId)) return true;
    return Array.isArray(game.players) && game.players.some((p) => p && p.userId === userId);
}

function ensureInviteList(game) {
    if (!Array.isArray(game.invites)) game.invites = [];
    return game.invites;
}

function ensureCustomList(obj) {
    if (!obj || typeof obj !== 'object') return [];
    if (!Array.isArray(obj.custom)) obj.custom = [];
    return obj.custom;
}

function findPlayer(game, userId) {
    return (game.players || []).find((p) => p && p.userId === userId);
}

function ensureInventoryList(player) {
    if (!player || typeof player !== 'object') return [];
    if (!Array.isArray(player.inventory)) player.inventory = [];
    return player.inventory;
}

/**
 * Locate a user record by id.
 *
 * @param {{ users: Array<{ id: string, username: string }> }} db
 * @param {string} userId
 */
function findUser(db, userId) {
    return (db.users || []).find((u) => u && u.id === userId) || null;
}

/**
 * Normalize incoming story configuration payloads.
 *
 * @param {any} body
 * @param {ReturnType<typeof ensureGameShape>} game
 */
function readStoryConfigUpdate(body, game) {
    const current = ensureStoryConfig(game);
    const pollMsRaw = Number(body?.pollIntervalMs);
    const hasBotToken = Object.prototype.hasOwnProperty.call(body || {}, 'botToken');
    const allowedPlayers = new Set(
        Array.isArray(game.players)
            ? game.players.map((p) => (p && typeof p.userId === 'string' ? p.userId : null)).filter(Boolean)
            : []
    );

    const scribeIds = Array.isArray(body?.scribeIds)
        ? Array.from(
              new Set(
                  body.scribeIds
                      .map((id) => parseUUID(id))
                      .filter((id) => id && allowedPlayers.has(id))
              )
          )
        : current.scribeIds;

    return {
        channelId: readSnowflake(body?.channelId),
        guildId: readSnowflake(body?.guildId),
        webhookUrl: readWebhookUrl(body?.webhookUrl),
        botToken: hasBotToken ? readBotToken(body?.botToken) : current.botToken,
        allowPlayerPosts: !!body?.allowPlayerPosts,
        pollIntervalMs: Number.isFinite(pollMsRaw)
            ? Math.min(120_000, Math.max(5_000, Math.round(pollMsRaw)))
            : current.pollIntervalMs,
        scribeIds,
    };
}

/**
 * Trim and clamp story content to Discord limits.
 *
 * @param {unknown} input
 */
function sanitizeStoryContent(input) {
    if (typeof input !== 'string') return '';
    const trimmed = input.trim();
    return trimmed.length > 2000 ? trimmed.slice(0, 2000) : trimmed;
}

/**
 * Dispatch a payload to a Discord webhook.
 *
 * @param {string} url
 * @param {{ content: string, username?: string, avatar_url?: string }} payload
 */
async function sendWebhookMessage(url, payload) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Discord webhook error ${res.status}: ${text.slice(0, 200)}`);
    }
}

/**
 * Resolve a persona selection into a Discord username/avatar payload.
 *
 * @param {{ persona?: string, targetUserId?: string }} selection
 * @param {{ db: any, game: ReturnType<typeof ensureGameShape>, actorId: string }} ctx
 */
function resolveStoryPersona(selection, { db, game, actorId }) {
    const story = ensureStoryConfig(game);
    const persona = typeof selection?.persona === 'string' ? selection.persona : 'self';
    const actorIsDM = isDM(game, actorId);
    const actorPlayer = findPlayer(game, actorId);
    const actorUser = findUser(db, actorId);

    const describePlayer = (player, user) => {
        if (!player) return user?.username || 'Player';
        const name = player.character?.name;
        if (typeof name === 'string' && name.trim()) return name.trim();
        return user?.username || `Player ${player.userId?.slice(0, 6) || ''}`;
    };

    if (persona === 'bot') {
        if (!actorIsDM) throw new Error('persona_forbidden');
        return { username: 'BOT' };
    }

    if (persona === 'dm') {
        if (!actorIsDM) throw new Error('persona_forbidden');
        return { username: 'Dungeon Master' };
    }

    if (persona === 'scribe') {
        if (!actorIsDM && !story.scribeIds.includes(actorId)) {
            throw new Error('persona_forbidden');
        }
        return { username: 'Scribe' };
    }

    if (persona === 'self') {
        if (actorPlayer) {
            return { username: describePlayer(actorPlayer, actorUser) };
        }
        if (actorIsDM) {
            return { username: actorUser?.username || 'Dungeon Master' };
        }
        return { username: actorUser?.username || 'Player' };
    }

    if (persona === 'player') {
        if (selection?.targetUserId) {
            if (!actorIsDM) throw new Error('persona_forbidden');
            const targetId = parseUUID(selection.targetUserId);
            if (!targetId) throw new Error('invalid_target');
            const targetPlayer = findPlayer(game, targetId);
            if (!targetPlayer) throw new Error('invalid_target');
            const targetUser = findUser(db, targetId);
            return { username: describePlayer(targetPlayer, targetUser) };
        }

        if (actorIsDM) {
            return { username: 'Player' };
        }

        if (actorPlayer) {
            return { username: describePlayer(actorPlayer, actorUser) };
        }
    }

    throw new Error('persona_forbidden');
}

/**
 * Produce a sanitized story configuration for API responses.
 *
 * @param {ReturnType<typeof ensureStoryConfig>} story
 * @param {{ includeSecrets?: boolean }} [options]
 */
function presentStoryConfig(story, { includeSecrets = false } = {}) {
    const normalized = story && typeof story === 'object'
        ? story
        : {
              channelId: '',
              guildId: '',
              webhookUrl: '',
              botToken: '',
              allowPlayerPosts: false,
              scribeIds: [],
              pollIntervalMs: 15_000,
          };
    const output = {
        channelId: normalized.channelId || '',
        guildId: normalized.guildId || '',
        allowPlayerPosts: !!normalized.allowPlayerPosts,
        scribeIds: Array.isArray(normalized.scribeIds) ? [...normalized.scribeIds] : [],
        pollIntervalMs: Number.isFinite(Number(normalized.pollIntervalMs))
            ? Number(normalized.pollIntervalMs)
            : 15_000,
        webhookConfigured: !!normalized.webhookUrl,
        botTokenConfigured: !!(normalized.botToken || getDiscordBotToken()),
    };
    if (includeSecrets) {
        output.webhookUrl = normalized.webhookUrl || '';
        output.botToken = normalized.botToken || '';
    }
    return output;
}

/**
 * Remove and stop a cached Discord watcher for the given game.
 *
 * @param {string} gameId
 */
function removeStoryWatcher(gameId) {
    const existing = storyWatchers.get(gameId);
    if (existing && existing.watcher && typeof existing.watcher.stop === 'function') {
        try {
            existing.watcher.stop();
        } catch {
            // ignore stop errors
        }
    }
    storyWatchers.delete(gameId);
}

/**
 * Ensure a watcher exists for the supplied game configuration.
 *
 * @param {ReturnType<typeof ensureGameShape>} game
 * @returns {ReturnType<typeof createDiscordWatcher>|null}
 */
function getOrCreateStoryWatcher(game) {
    const story = ensureStoryConfig(game);
    const token = story.botToken || getDiscordBotToken();
    if (!token || !story.channelId) {
        removeStoryWatcher(game.id);
        return null;
    }

    const signature = `${token}:${story.channelId}:${story.guildId || ''}:${story.pollIntervalMs}`;
    const existing = storyWatchers.get(game.id);
    if (existing && existing.signature === signature) {
        return existing.watcher;
    }

    removeStoryWatcher(game.id);
    const watcher = createDiscordWatcher({
        token,
        guildId: story.guildId || undefined,
        channelId: story.channelId,
        pollIntervalMs: story.pollIntervalMs,
    });
    if (watcher.enabled) {
        watcher.start();
        storyWatchers.set(game.id, { watcher, signature });
        return watcher;
    }
    return null;
}

/**
 * Build the story log snapshot for a game.
 *
 * @param {ReturnType<typeof ensureGameShape>} game
 */
function getStorySnapshot(game) {
    const story = ensureStoryConfig(game);
    const token = story.botToken || getDiscordBotToken();
    if (!token) {
        removeStoryWatcher(game.id);
        return {
            enabled: false,
            status: {
                enabled: false,
                phase: 'missing_token',
                error: 'No Discord bot token configured for this campaign.',
                pollIntervalMs: story.pollIntervalMs,
                channel: null,
            },
            channel: null,
            messages: [],
        };
    }

    if (!story.channelId) {
        removeStoryWatcher(game.id);
        return {
            enabled: false,
            status: {
                enabled: false,
                phase: 'unconfigured',
                error: 'No Discord channel configured for this campaign.',
                pollIntervalMs: story.pollIntervalMs,
                channel: null,
            },
            channel: null,
            messages: [],
        };
    }

    const watcher = getOrCreateStoryWatcher(game);
    if (!watcher) {
        return {
            enabled: false,
            status: {
                enabled: false,
                phase: 'configuring',
                error: 'Discord watcher is not ready yet.',
                pollIntervalMs: story.pollIntervalMs,
                channel: null,
            },
            channel: null,
            messages: [],
        };
    }

    const status = watcher.getStatus();
    return {
        enabled: true,
        status,
        channel: status.channel || null,
        messages: watcher.getMessages(),
    };
}

function canEditInventory(game, actingUserId, targetUserId) {
    if (isDM(game, actingUserId)) return true;
    if (actingUserId !== targetUserId) return false;
    return !!game.permissions?.canEditItems;
}

function ensureGear(player) {
    if (!player || typeof player !== 'object') {
        return {
            bag: [],
            slots: GEAR_SLOTS.reduce((acc, slot) => {
                acc[slot] = null;
                return acc;
            }, {}),
        };
    }
    const normalized = ensureGearState(player);
    player.gear = normalized;
    return normalized;
}

function ensureGearBag(player) {
    return ensureGear(player).bag;
}

function canEditGear(game, actingUserId, targetUserId) {
    if (isDM(game, actingUserId)) return true;
    if (actingUserId !== targetUserId) return false;
    return !!game.permissions?.canEditGear;
}

function generateInviteCode(existing) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    const existingSet = new Set(existing || []);
    do {
        code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    } while (existingSet.has(code));
    return code;
}

function sanitizeText(value) {
    if (value == null) return '';
    return String(value).slice(0, 500);
}

function normalizeCount(value, fallback = 0) {
    if (value === undefined || value === null || value === '') return fallback;
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    const rounded = Math.round(num);
    return rounded < 0 ? 0 : rounded;
}

/**
 * Validate a Discord snowflake identifier.
 *
 * @param {unknown} value
 * @returns {string}
 */
function readSnowflake(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    return /^\d{5,25}$/.test(trimmed) ? trimmed : '';
}

/**
 * Validate a Discord webhook URL. Supports discord.com and discordapp.com hosts.
 *
 * @param {unknown} value
 * @returns {string}
 */
function readWebhookUrl(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    try {
        const url = new URL(trimmed);
        const host = url.host.toLowerCase();
        if (!host.endsWith('discord.com') && !host.endsWith('discordapp.com')) return '';
        if (!url.pathname.startsWith('/api/webhooks/')) return '';
        return url.toString();
    } catch {
        return '';
    }
}

/**
 * Normalize a Discord bot token string. Tokens are opaque, so we simply trim
 * surrounding whitespace and clamp the length to a reasonable limit.
 *
 * @param {unknown} value
 * @returns {string}
 */
function readBotToken(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    return trimmed.slice(0, 256);
}

/**
 * Ensure the story configuration is normalized on the game object.
 *
 * @param {any} game
 * @returns {{ channelId: string, guildId: string, webhookUrl: string, botToken: string, allowPlayerPosts: boolean, scribeIds: string[], pollIntervalMs: number }}
 */
function ensureStoryConfig(game) {
    const raw = game && typeof game.story === 'object' ? game.story : {};
    const channelId = readSnowflake(raw.channelId);
    const guildId = readSnowflake(raw.guildId);
    const webhookUrl = readWebhookUrl(raw.webhookUrl);
    const botToken = readBotToken(raw.botToken);
    const allowPlayerPosts = !!raw.allowPlayerPosts;
    const pollMsRaw = Number(raw.pollIntervalMs);
    const pollIntervalMs = Number.isFinite(pollMsRaw)
        ? Math.min(120_000, Math.max(5_000, Math.round(pollMsRaw)))
        : 15_000;
    const allowedPlayers = new Set(
        Array.isArray(game?.players)
            ? game.players.map((p) => (p && typeof p.userId === 'string' ? p.userId : null)).filter(Boolean)
            : []
    );
    const scribeIds = Array.isArray(raw.scribeIds)
        ? Array.from(
              new Set(
                  raw.scribeIds
                      .map((id) => parseUUID(id))
                      .filter((id) => id && allowedPlayers.has(id))
              )
          )
        : [];

    const normalized = {
        channelId,
        guildId,
        webhookUrl,
        botToken,
        allowPlayerPosts,
        scribeIds,
        pollIntervalMs,
    };
    game.story = normalized;
    return normalized;
}

const USERNAME_REGEX = /^[A-Za-z0-9_]{3,30}$/;
const INVALID_GAME_NAME_CHARS = /[<>\n\r\t]/;
const INVITE_CODE_REGEX = /^[A-Z0-9]{6}$/;
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readUsername(value) {
    if (typeof value !== 'string') return null;
    const username = value.trim();
    if (!USERNAME_REGEX.test(username)) return null;
    return username;
}

function readPassword(value) {
    if (typeof value !== 'string') return null;
    const password = value;
    if (password.length < 8 || password.length > 128) return null;
    return password;
}

function readGameName(value) {
    if (typeof value !== 'string') return null;
    const name = value.trim();
    if (!name || name.length > 100) return null;
    if (INVALID_GAME_NAME_CHARS.test(name)) return null;
    return name;
}

function parseInviteCode(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toUpperCase();
    if (!INVITE_CODE_REGEX.test(normalized)) return null;
    return normalized;
}

function parseUUID(value) {
    if (typeof value !== 'string') return null;
    const id = value.trim();
    if (!UUID_V4_REGEX.test(id)) return null;
    return id;
}

// --- helpers ---
function normalizeDB(raw) {
    const db = raw && typeof raw === 'object' ? raw : {};
    return {
        users: Array.isArray(db.users) ? db.users : [],
        games: Array.isArray(db.games)
            ? db.games
                .map((g) => ensureGameShape({ ...g }))
                .filter(Boolean)
            : [],
    };
}

async function readDB() {
    try {
        const json = await fs.readFile(DB_PATH, 'utf8');
        return normalizeDB(JSON.parse(json));
    } catch {
        return { users: [], games: [] };
    }
}

async function writeDB(db) {
    await fs.writeFile(DB_PATH, JSON.stringify(normalizeDB(db), null, 2));
}

function hash(pw, salt) {
    return crypto.createHash('sha256').update(salt + pw).digest('hex');
}

const app = express();

// CORS for Vite dev server
app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true,
}));

app.use(express.json());

// if you ever run behind a proxy/https later
// app.set('trust proxy', 1);

app.use(session({
    secret: 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        sameSite: 'lax',   // 'lax' works for http://localhost:5173 -> http://localhost:3000
        secure: false,     // set true only behind https
    },
}));

function requireAuth(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ error: 'unauthenticated' });
    next();
}

// --- Auth ---
app.get('/api/auth/me', async (req, res) => {
    const db = await readDB();
    const user = db.users.find(u => u.id === req.session.userId);
    res.json(user ? { id: user.id, username: user.username } : null);
});

app.post('/api/auth/register', async (req, res) => {
    const username = readUsername(req.body?.username);
    const password = readPassword(req.body?.password);
    if (!username || !password) return res.status(400).json({ error: 'invalid fields' });

    const db = await readDB();
    const exists = db.users.some((u) =>
        typeof u?.username === 'string' && u.username.toLowerCase() === username.toLowerCase()
    );
    if (exists) return res.status(400).json({ error: 'user exists' });

    const salt = crypto.randomBytes(8).toString('hex');
    const user = { id: uuid(), username, pass: `${salt}$${hash(password, salt)}` };
    db.users.push(user);
    await writeDB(db);

    req.session.userId = user.id;
    res.json({ id: user.id, username: user.username });
});

app.post('/api/auth/login', async (req, res) => {
    const username = readUsername(req.body?.username);
    const password = readPassword(req.body?.password);
    if (!username || !password) return res.status(400).json({ error: 'invalid credentials' });

    const db = await readDB();
    const user = db.users.find(
        (u) => typeof u?.username === 'string' && u.username.toLowerCase() === username.toLowerCase()
    );
    if (!user) return res.status(400).json({ error: 'invalid credentials' });

    const [salt, stored] = user.pass.split('$');
    if (!salt || !stored || hash(password, salt) !== stored) {
        return res.status(400).json({ error: 'invalid credentials' });
    }

    req.session.userId = user.id;
    res.json({ id: user.id, username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
});

// --- Games ---
app.get('/api/games', requireAuth, async (req, res) => {
    const db = await readDB();
    const games = (db.games || [])
        .filter(g => g && Array.isArray(g.players) && g.players.some(p => p.userId === req.session.userId))
        .map(g => ({ id: g.id, name: g.name, dmId: g.dmId, players: g.players || [] }));
    res.json(games);
});

app.post('/api/games', requireAuth, async (req, res) => {
    const name = readGameName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'invalid name' });

    const db = await readDB();
    const game = {
        id: uuid(),
        name,
        dmId: req.session.userId,
        players: [{
            userId: req.session.userId,
            role: 'dm',
            character: null,
            inventory: [],
            gear: { bag: [], slots: { weapon: null, armor: null, accessory: null } },
        }],
        items: { custom: [] },
        gear: { custom: [] },
        demons: [],
        demonPool: { max: 0, used: 0 },
        permissions: { canEditStats: false, canEditItems: false, canEditGear: false, canEditDemons: false },
        invites: [],
        story: {
            channelId: '',
            guildId: '',
            webhookUrl: '',
            botToken: '',
            allowPlayerPosts: false,
            scribeIds: [],
            pollIntervalMs: 15_000,
        },
    };
    db.games.push(game);
    await writeDB(db);
    res.json(game);
});

app.get('/api/games/:id', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const g = getGame(db, id);
    if (!g || !isMember(g, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }

    const story = ensureStoryConfig(g);
    const includeSecrets = isDM(g, req.session.userId);
    const out = {
        id: g.id,
        name: g.name,
        dmId: g.dmId,
        players: g.players,
        items: g.items,
        gear: g.gear,
        demons: g.demons,
        demonPool: g.demonPool,
        permissions: g.permissions,
        invites: g.invites,
        story: presentStoryConfig(story, { includeSecrets }),
    };

    res.json(out);
});

app.post('/api/games/:id/invites', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const invites = ensureInviteList(game);
    const code = generateInviteCode(invites.map((i) => i.code));
    const invite = {
        code,
        createdBy: req.session.userId,
        createdAt: new Date().toISOString(),
        uses: 0,
    };
    invites.push(invite);
    saveGame(db, game);
    await writeDB(db);
    res.json({ code, joinUrl: `/join/${code}` });
});

app.post('/api/games/join/:code', requireAuth, async (req, res) => {
    const code = parseInviteCode(req.params?.code);
    if (!code) return res.status(400).json({ error: 'invalid_code' });

    const db = await readDB();
    const game = (db.games || []).map((g) => ensureGameShape(g)).find((g) =>
        Array.isArray(g?.invites) && g.invites.some((inv) => inv && inv.code === code)
    );
    if (!game) return res.status(404).json({ error: 'not_found' });

    if (!isMember(game, req.session.userId)) {
        game.players.push({
            userId: req.session.userId,
            role: 'player',
            character: null,
            inventory: [],
        gear: { bag: [], slots: { weapon: null, armor: null, accessory: null } },
        });
    }

    game.invites = game.invites.map((inv) => inv && inv.code === code
        ? { ...inv, uses: (inv.uses || 0) + 1, lastUsedAt: new Date().toISOString() }
        : inv
    );

    saveGame(db, game);
    await writeDB(db);
    res.json({ ok: true, gameId: game.id });
});

app.delete('/api/games/:id/players/:playerId', requireAuth, async (req, res) => {
    const { id, playerId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const target = findPlayer(game, playerId);
    if (!target) {
        return res.status(404).json({ error: 'player_not_found' });
    }
    if ((target.role || '').toLowerCase() === 'dm') {
        return res.status(400).json({ error: 'cannot_remove_dm' });
    }

    game.players = (game.players || []).filter((p) => p && p.userId !== playerId);
    saveGame(db, game);
    await writeDB(db);
    res.json({ ok: true });
});

app.put('/api/games/:id/permissions', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const perms = req.body || {};
    game.permissions = {
        canEditStats: !!perms.canEditStats,
        canEditItems: !!perms.canEditItems,
        canEditGear: !!perms.canEditGear,
        canEditDemons: !!perms.canEditDemons,
    };
    saveGame(db, game);
    await writeDB(db);
    res.json(game.permissions);
});

app.put('/api/games/:id/character', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }

    const { character } = req.body || {};
    const userId = req.session.userId;
    const slot = game.players.find((p) => p && p.userId === userId);
    const canEdit = isDM(game, userId) || !!game.permissions.canEditStats;
    if (!isDM(game, userId) && !canEdit) {
        return res.status(403).json({ error: 'forbidden' });
    }

    if (isDM(game, userId) && character?.userId && character.userId !== userId) {
        // DM can update another player's sheet if userId provided
        const target = game.players.find((p) => p && p.userId === character.userId);
        if (target) target.character = character.character ?? character;
    } else if (slot) {
        slot.character = character ?? null;
    }

    saveGame(db, game);
    await writeDB(db);
    res.json({ ok: true });
});

app.delete('/api/games/:id', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const gameId = game.id;
    removeStoryWatcher(gameId);
    db.games = (db.games || []).filter((g) => g && g.id !== gameId);
    await writeDB(db);
    res.json({ ok: true });
});

function validateCustomItem(item) {
    return {
        name: sanitizeText(item?.name),
        type: sanitizeText(item?.type),
        desc: sanitizeText(item?.desc),
    };
}

app.post('/api/games/:id/items/custom', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId) && !game.permissions.canEditItems) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const item = validateCustomItem(req.body?.item || req.body);
    if (!item.name) return res.status(400).json({ error: 'missing name' });

    const list = ensureCustomList(game.items);
    const entry = { id: uuid(), ...item };
    list.push(entry);
    saveGame(db, game);
    await writeDB(db);
    res.json(entry);
});

app.put('/api/games/:id/items/custom/:itemId', requireAuth, async (req, res) => {
    const { id, itemId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId) && !game.permissions.canEditItems) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const list = ensureCustomList(game.items);
    const idx = list.findIndex((it) => it && it.id === itemId);
    if (idx === -1) return res.status(404).json({ error: 'item_not_found' });

    const item = { ...list[idx], ...validateCustomItem(req.body?.item || req.body) };
    list[idx] = item;
    saveGame(db, game);
    await writeDB(db);
    res.json(item);
});

app.delete('/api/games/:id/items/custom/:itemId', requireAuth, async (req, res) => {
    const { id, itemId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId) && !game.permissions.canEditItems) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const list = ensureCustomList(game.items);
    const next = list.filter((it) => it && it.id !== itemId);
    game.items.custom = next;
    saveGame(db, game);
    await writeDB(db);
    res.json({ ok: true });
});

app.post('/api/games/:id/players/:playerId/items', requireAuth, async (req, res) => {
    const { id, playerId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }

    const target = findPlayer(game, playerId);
    if (!target) return res.status(404).json({ error: 'player_not_found' });
    if ((target.role || '').toLowerCase() === 'dm') {
        return res.status(400).json({ error: 'dm_has_no_inventory' });
    }

    const actor = req.session.userId;
    if (!canEditInventory(game, actor, playerId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const payload = req.body?.item || req.body || {};
    const name = sanitizeText(payload.name).trim();
    if (!name) return res.status(400).json({ error: 'missing name' });
    const type = sanitizeText(payload.type).trim();
    const desc = sanitizeText(payload.desc);
    const amountRaw = normalizeCount(payload.amount ?? payload.qty, 1);
    const amount = amountRaw <= 0 ? 1 : amountRaw;

    const entry = {
        id: uuid(),
        name,
        type,
        desc,
        amount,
    };

    const list = ensureInventoryList(target);
    list.push(entry);
    saveGame(db, game);
    await writeDB(db);
    res.json(entry);
});

app.put('/api/games/:id/players/:playerId/items/:itemId', requireAuth, async (req, res) => {
    const { id, playerId, itemId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }

    const target = findPlayer(game, playerId);
    if (!target) return res.status(404).json({ error: 'player_not_found' });
    if ((target.role || '').toLowerCase() === 'dm') {
        return res.status(400).json({ error: 'dm_has_no_inventory' });
    }

    const actor = req.session.userId;
    if (!canEditInventory(game, actor, playerId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const list = ensureInventoryList(target);
    const entry = list.find((it) => it && it.id === itemId);
    if (!entry) return res.status(404).json({ error: 'item_not_found' });

    const payload = req.body?.item || req.body || {};
    if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
        const name = sanitizeText(payload.name).trim();
        if (!name) return res.status(400).json({ error: 'missing name' });
        entry.name = name;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'type')) {
        entry.type = sanitizeText(payload.type).trim();
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'desc')) {
        entry.desc = sanitizeText(payload.desc);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'amount') || Object.prototype.hasOwnProperty.call(payload, 'qty')) {
        entry.amount = normalizeCount(payload.amount ?? payload.qty, entry.amount);
    }

    saveGame(db, game);
    await writeDB(db);
    res.json(entry);
});

app.delete('/api/games/:id/players/:playerId/items/:itemId', requireAuth, async (req, res) => {
    const { id, playerId, itemId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }

    const target = findPlayer(game, playerId);
    if (!target) return res.status(404).json({ error: 'player_not_found' });
    if ((target.role || '').toLowerCase() === 'dm') {
        return res.status(400).json({ error: 'dm_has_no_inventory' });
    }

    const actor = req.session.userId;
    if (!canEditInventory(game, actor, playerId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const list = ensureInventoryList(target);
    const next = list.filter((it) => it && it.id !== itemId);
    if (next.length === list.length) {
        return res.status(404).json({ error: 'item_not_found' });
    }
    target.inventory = next;
    saveGame(db, game);
    await writeDB(db);
    res.json({ ok: true });
});

app.post('/api/games/:id/players/:playerId/gear/bag', requireAuth, async (req, res) => {
    const { id, playerId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }

    const target = findPlayer(game, playerId);
    if (!target) return res.status(404).json({ error: 'player_not_found' });
    if ((target.role || '').toLowerCase() === 'dm') {
        return res.status(400).json({ error: 'dm_has_no_gear' });
    }

    const actor = req.session.userId;
    if (!canEditGear(game, actor, playerId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const payload = req.body?.item || req.body || {};
    const name = sanitizeText(payload.name).trim();
    if (!name) return res.status(400).json({ error: 'missing name' });
    const type = sanitizeText(payload.type).trim();
    const desc = sanitizeText(payload.desc);

    const gearState = ensureGear(target);
    const bag = gearState.bag;
    const entry = {
        id: typeof payload.id === 'string' && payload.id ? payload.id : uuid(),
        name,
        type,
        desc,
    };

    const existingIdx = bag.findIndex((it) => it && it.id === entry.id);
    if (existingIdx === -1) {
        bag.push(entry);
    } else {
        bag[existingIdx] = entry;
    }

    saveGame(db, game);
    await writeDB(db);
    res.json(entry);
});

app.put('/api/games/:id/players/:playerId/gear/bag/:itemId', requireAuth, async (req, res) => {
    const { id, playerId, itemId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }

    const target = findPlayer(game, playerId);
    if (!target) return res.status(404).json({ error: 'player_not_found' });
    if ((target.role || '').toLowerCase() === 'dm') {
        return res.status(400).json({ error: 'dm_has_no_gear' });
    }

    const actor = req.session.userId;
    if (!canEditGear(game, actor, playerId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const bag = ensureGearBag(target);
    const entry = bag.find((it) => it && it.id === itemId);
    if (!entry) {
        return res.status(404).json({ error: 'gear_item_not_found' });
    }

    const payload = req.body?.item || req.body || {};
    if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
        const name = sanitizeText(payload.name).trim();
        if (!name) return res.status(400).json({ error: 'missing name' });
        entry.name = name;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'type')) {
        entry.type = sanitizeText(payload.type).trim();
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'desc')) {
        entry.desc = sanitizeText(payload.desc);
    }

    saveGame(db, game);
    await writeDB(db);
    res.json(entry);
});

app.delete('/api/games/:id/players/:playerId/gear/bag/:itemId', requireAuth, async (req, res) => {
    const { id, playerId, itemId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }

    const target = findPlayer(game, playerId);
    if (!target) return res.status(404).json({ error: 'player_not_found' });
    if ((target.role || '').toLowerCase() === 'dm') {
        return res.status(400).json({ error: 'dm_has_no_gear' });
    }

    const actor = req.session.userId;
    if (!canEditGear(game, actor, playerId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const gearState = ensureGear(target);
    const bag = gearState.bag;
    const idx = bag.findIndex((it) => it && it.id === itemId);
    if (idx === -1) {
        return res.status(404).json({ error: 'gear_item_not_found' });
    }

    const [removed] = bag.splice(idx, 1);
    if (removed) {
        const slots = gearState.slots;
        for (const slot of GEAR_SLOTS) {
            if (slots?.[slot]?.itemId === removed.id) {
                slots[slot] = null;
            }
        }
    }

    saveGame(db, game);
    await writeDB(db);
    res.json({ ok: true });
});

async function handleEquipSlot(req, res) {
    const { id, playerId } = req.params || {};
    const slot = (req.params?.slot || '').toLowerCase();
    if (!GEAR_SLOTS.includes(slot)) {
        res.status(400).json({ error: 'invalid_slot' });
        return null;
    }

    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        res.status(404).json({ error: 'not_found' });
        return null;
    }

    const target = findPlayer(game, playerId);
    if (!target) {
        res.status(404).json({ error: 'player_not_found' });
        return null;
    }
    if ((target.role || '').toLowerCase() === 'dm') {
        res.status(400).json({ error: 'dm_has_no_gear' });
        return null;
    }

    const actor = req.session.userId;
    if (!canEditGear(game, actor, playerId)) {
        res.status(403).json({ error: 'forbidden' });
        return null;
    }

    return { db, game, target, slot };
}

async function equipSlotPut(req, res) {
    const context = await handleEquipSlot(req, res);
    if (!context) return;
    const { db, game, target, slot } = context;

    const gearState = ensureGear(target);
    const bag = gearState.bag;
    const slots = gearState.slots;

    const payload = req.body?.item || req.body || {};
    let itemId = null;

    if (typeof payload.itemId === 'string') {
        const trimmed = payload.itemId.trim();
        if (!trimmed) {
            slots[slot] = null;
            saveGame(db, game);
            await writeDB(db);
            res.json({ ok: true });
            return;
        }
        const match = bag.find((it) => it && it.id === trimmed);
        if (!match) {
            res.status(404).json({ error: 'gear_item_not_found' });
            return;
        }
        itemId = match.id;
    } else {
        const name = sanitizeText(payload.name).trim();
        if (!name) {
            res.status(400).json({ error: 'missing name' });
            return;
        }
        const type = sanitizeText(payload.type).trim();
        const desc = sanitizeText(payload.desc);
        const entry = {
            id: typeof payload.id === 'string' && payload.id ? payload.id : uuid(),
            name,
            type,
            desc,
        };
        const existingIdx = bag.findIndex((it) => it && it.id === entry.id);
        if (existingIdx === -1) {
            bag.push(entry);
        } else {
            bag[existingIdx] = entry;
        }
        itemId = entry.id;
    }

    slots[slot] = itemId ? { itemId } : null;

    saveGame(db, game);
    await writeDB(db);
    const item = bag.find((it) => it && it.id === itemId) || null;
    res.json({ slot, itemId, item });
}

async function equipSlotDelete(req, res) {
    const context = await handleEquipSlot(req, res);
    if (!context) return;
    const { db, game, target, slot } = context;

    const gearState = ensureGear(target);
    const slots = gearState.slots;
    if (!slots?.[slot]) {
        res.status(404).json({ error: 'gear_not_found' });
        return;
    }

    slots[slot] = null;
    saveGame(db, game);
    await writeDB(db);
    res.json({ ok: true });
}

app.put('/api/games/:id/players/:playerId/gear/:slot', requireAuth, equipSlotPut);
app.put('/api/games/:id/players/:playerId/gear/slots/:slot', requireAuth, equipSlotPut);

app.delete('/api/games/:id/players/:playerId/gear/:slot', requireAuth, equipSlotDelete);
app.delete('/api/games/:id/players/:playerId/gear/slots/:slot', requireAuth, equipSlotDelete);

app.post('/api/games/:id/gear/custom', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId) && !game.permissions.canEditGear) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const item = validateCustomItem(req.body?.item || req.body);
    if (!item.name) return res.status(400).json({ error: 'missing name' });

    const list = ensureCustomList(game.gear);
    const entry = { id: uuid(), ...item };
    list.push(entry);
    saveGame(db, game);
    await writeDB(db);
    res.json(entry);
});

app.put('/api/games/:id/gear/custom/:itemId', requireAuth, async (req, res) => {
    const { id, itemId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId) && !game.permissions.canEditGear) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const list = ensureCustomList(game.gear);
    const idx = list.findIndex((it) => it && it.id === itemId);
    if (idx === -1) return res.status(404).json({ error: 'item_not_found' });

    const item = { ...list[idx], ...validateCustomItem(req.body?.item || req.body) };
    list[idx] = item;
    saveGame(db, game);
    await writeDB(db);
    res.json(item);
});

app.delete('/api/games/:id/gear/custom/:itemId', requireAuth, async (req, res) => {
    const { id, itemId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId) && !game.permissions.canEditGear) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const list = ensureCustomList(game.gear);
    const next = list.filter((it) => it && it.id !== itemId);
    game.gear.custom = next;
    saveGame(db, game);
    await writeDB(db);
    res.json({ ok: true });
});

function normalizeArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map((v) => sanitizeText(v)).filter(Boolean);
    return String(value)
        .split(/[,\n]/)
        .map((v) => sanitizeText(v.trim()))
        .filter(Boolean);
}

app.post('/api/games/:id/demons', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const body = req.body || {};
    const demon = {
        id: uuid(),
        name: sanitizeText(body.name),
        arcana: sanitizeText(body.arcana),
        alignment: sanitizeText(body.alignment),
        level: Number(body.level) || 0,
        stats: {
            strength: Number(body.stats?.strength) || 0,
            magic: Number(body.stats?.magic) || 0,
            endurance: Number(body.stats?.endurance) || 0,
            agility: Number(body.stats?.agility) || 0,
            luck: Number(body.stats?.luck) || 0,
        },
        resistances: {
            weak: normalizeArray(body.resistances?.weak),
            resist: normalizeArray(body.resistances?.resist),
            null: normalizeArray(body.resistances?.null),
            absorb: normalizeArray(body.resistances?.absorb),
            reflect: normalizeArray(body.resistances?.reflect),
        },
        skills: normalizeArray(body.skills),
        notes: sanitizeText(body.notes || ''),
    };

    if (!demon.name) return res.status(400).json({ error: 'missing name' });

    game.demons.push(demon);
    saveGame(db, game);
    await writeDB(db);
    res.json(demon);
});

app.put('/api/games/:id/demons/:demonId', requireAuth, async (req, res) => {
    const { id, demonId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId) && !game.permissions.canEditDemons) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const idx = game.demons.findIndex((d) => d && d.id === demonId);
    if (idx === -1) return res.status(404).json({ error: 'demon_not_found' });

    const body = req.body || {};
    const current = game.demons[idx] || {};
    const updated = {
        ...current,
        name: sanitizeText(body.name ?? current.name),
        arcana: sanitizeText(body.arcana ?? current.arcana),
        alignment: sanitizeText(body.alignment ?? current.alignment),
        level: Number(body.level ?? current.level) || 0,
        stats: {
            strength: Number(body.stats?.strength ?? current.stats?.strength) || 0,
            magic: Number(body.stats?.magic ?? current.stats?.magic) || 0,
            endurance: Number(body.stats?.endurance ?? current.stats?.endurance) || 0,
            agility: Number(body.stats?.agility ?? current.stats?.agility) || 0,
            luck: Number(body.stats?.luck ?? current.stats?.luck) || 0,
        },
        resistances: {
            weak: body.resistances?.weak !== undefined ? normalizeArray(body.resistances?.weak) : (current.resistances?.weak || []),
            resist: body.resistances?.resist !== undefined ? normalizeArray(body.resistances?.resist) : (current.resistances?.resist || []),
            null: body.resistances?.null !== undefined ? normalizeArray(body.resistances?.null) : (current.resistances?.null || []),
            absorb: body.resistances?.absorb !== undefined ? normalizeArray(body.resistances?.absorb) : (current.resistances?.absorb || []),
            reflect: body.resistances?.reflect !== undefined ? normalizeArray(body.resistances?.reflect) : (current.resistances?.reflect || []),
        },
        skills: body.skills !== undefined ? normalizeArray(body.skills) : (current.skills || []),
        notes: sanitizeText(body.notes ?? current.notes ?? ''),
    };

    game.demons[idx] = updated;
    saveGame(db, game);
    await writeDB(db);
    res.json(updated);
});

app.delete('/api/games/:id/demons/:demonId', requireAuth, async (req, res) => {
    const { id, demonId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const next = game.demons.filter((d) => d && d.id !== demonId);
    game.demons = next;
    saveGame(db, game);
    await writeDB(db);
    res.json({ ok: true });
});

app.get('/api/games/:id/story-log', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }

    const snapshot = getStorySnapshot(game);
    const story = ensureStoryConfig(game);
    res.json({
        ...snapshot,
        config: presentStoryConfig(story, { includeSecrets: false }),
        fetchedAt: new Date().toISOString(),
    });
});

app.put('/api/games/:id/story-config', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const update = readStoryConfigUpdate(req.body || {}, game);
    game.story = { ...game.story, ...update };
    ensureStoryConfig(game);
    removeStoryWatcher(game.id);
    getOrCreateStoryWatcher(game);
    saveGame(db, game);
    await writeDB(db);

    res.json({
        ok: true,
        story: presentStoryConfig(game.story, { includeSecrets: true }),
    });
});

app.post('/api/games/:id/story-log/messages', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }

    const story = ensureStoryConfig(game);
    const actorId = req.session.userId;
    const actorIsDM = isDM(game, actorId);
    if (!actorIsDM && !story.allowPlayerPosts) {
        return res.status(403).json({ error: 'forbidden' });
    }

    if (!story.webhookUrl) {
        return res.status(400).json({ error: 'not_configured' });
    }

    const content = sanitizeStoryContent(req.body?.content);
    if (!content) {
        return res.status(400).json({ error: 'empty_content' });
    }

    let persona;
    try {
        persona = resolveStoryPersona(req.body || {}, { db, game, actorId });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'persona_forbidden';
        if (message === 'invalid_target') {
            return res.status(400).json({ error: 'invalid_target' });
        }
        return res.status(403).json({ error: 'persona_forbidden' });
    }

    try {
        await sendWebhookMessage(story.webhookUrl, {
            content,
            username: persona.username,
            avatar_url: persona.avatarUrl || undefined,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'webhook_error';
        return res.status(502).json({ error: 'webhook_error', message });
    }

    getOrCreateStoryWatcher(game);

    res.status(201).json({ ok: true });
});

// --- Items ---
app.get('/api/items/premade', async (_req, res) => {
    try {
        const items = JSON.parse(await fs.readFile(ITEMS_PATH, 'utf8'));
        res.json(items);
    } catch {
        res.json([]);
    }
});

// Persona proxy routes
app.use('/api/personas', personas);

// Static files (if built)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'dist')));

if (SPA_INDEX) {
    app.get('/join/:code', (_req, res) => {
        res.sendFile(SPA_INDEX);
    });
}

// centralized error handler (prevents crashing the process)
app.use((err, _req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }
    console.error(err);
    res.status(500).json({ error: 'server_error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`server listening on ${PORT}`));
