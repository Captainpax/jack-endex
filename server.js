/* eslint-env node */
/* global process */
import http from 'http';
import express from 'express';
import session from 'express-session';
import { WebSocketServer } from 'ws';
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
const storySubscribers = new Map();
const gameSubscribers = new Map();
const userSockets = new Map();
const pendingPersonaRequests = new Map();
const pendingTrades = new Map();
const storyBroadcastQueue = new Map();
const DISCORD_API_BASE = 'https://discord.com/api/v10';
const PERSONA_REQUEST_TIMEOUT_MS = 120_000;
const TRADE_TIMEOUT_MS = 180_000;
const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const MAX_ALERT_LENGTH = 500;

function parseYouTubeTimecode(raw) {
    if (typeof raw !== 'string') return 0;
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    if (/^\d+$/.test(trimmed)) {
        const num = Number(trimmed);
        return Number.isFinite(num) && num >= 0 ? num : 0;
    }
    let total = 0;
    let matched = false;
    const pattern = /(\d+)(h|m|s)/gi;
    let match;
    while ((match = pattern.exec(trimmed)) !== null) {
        matched = true;
        const value = Number(match[1]);
        if (!Number.isFinite(value)) continue;
        const unit = match[2].toLowerCase();
        if (unit === 'h') total += value * 3600;
        else if (unit === 'm') total += value * 60;
        else if (unit === 's') total += value;
    }
    if (matched) return total;
    return 0;
}

function parseYouTubeInput(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (YOUTUBE_ID_REGEX.test(trimmed)) {
        return {
            videoId: trimmed,
            startSeconds: 0,
            url: `https://youtu.be/${trimmed}`,
        };
    }
    try {
        const url = new URL(trimmed, 'https://youtube.com');
        const host = url.hostname.toLowerCase();
        let videoId = '';
        if (host.endsWith('youtu.be')) {
            const parts = url.pathname.split('/').filter(Boolean);
            videoId = parts[0] || '';
        } else if (host.includes('youtube.')) {
            if (url.pathname.startsWith('/watch')) {
                videoId = url.searchParams.get('v') || '';
            } else {
                const segments = url.pathname.split('/').filter(Boolean);
                if (segments[0] === 'embed' || segments[0] === 'shorts') {
                    videoId = segments[1] || '';
                }
            }
        }
        if (!YOUTUBE_ID_REGEX.test(videoId)) return null;
        let startSeconds = 0;
        const timeParam = url.searchParams.get('t') || url.searchParams.get('start');
        if (timeParam) {
            startSeconds = parseYouTubeTimecode(timeParam);
        }
        if (url.hash) {
            const hash = url.hash.replace(/^#/, '');
            if (hash.startsWith('t=')) {
                startSeconds = parseYouTubeTimecode(hash.slice(2));
            }
        }
        return {
            videoId,
            startSeconds,
            url: url.toString(),
        };
    } catch {
        return null;
    }
}

function ensureMediaState(game) {
    const raw = game && typeof game.media === 'object' ? game.media : {};
    const url = typeof raw.url === 'string' ? raw.url.trim() : '';
    const videoId = typeof raw.videoId === 'string' ? raw.videoId.trim() : '';
    const startRaw = Number(raw.startSeconds);
    const startSeconds = Number.isFinite(startRaw) && startRaw >= 0 ? Math.floor(startRaw) : 0;
    const playing = !!raw.playing && YOUTUBE_ID_REGEX.test(videoId);
    const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString();
    const normalized = {
        url: playing ? url.slice(0, 500) : '',
        videoId: playing ? videoId : '',
        startSeconds: playing ? startSeconds : 0,
        playing,
        updatedAt,
    };
    game.media = normalized;
    return normalized;
}

function presentMediaState(media) {
    if (!media || typeof media !== 'object') {
        return { playing: false, videoId: '', url: '', startSeconds: 0, updatedAt: null };
    }
    const videoId = typeof media.videoId === 'string' ? media.videoId : '';
    const playing = !!media.playing && YOUTUBE_ID_REGEX.test(videoId);
    const startRaw = Number(media.startSeconds);
    const startSeconds = Number.isFinite(startRaw) && startRaw >= 0 ? Math.floor(startRaw) : 0;
    const url = typeof media.url === 'string' ? media.url : '';
    const updatedAt = typeof media.updatedAt === 'string' ? media.updatedAt : new Date().toISOString();
    if (!playing) {
        return { playing: false, videoId: '', url: '', startSeconds: 0, updatedAt };
    }
    return { playing, videoId, url, startSeconds, updatedAt };
}

function sanitizeAlertMessage(value) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, MAX_ALERT_LENGTH);
}

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
const TXT_DOCS_PATH = path.join(__dirname, 'txtdocs');
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
    game.worldSkills = ensureWorldSkills(game);
    game.media = ensureMediaState(game);
    return game;
}

function presentGame(game, { includeSecrets = false } = {}) {
    const normalized = ensureGameShape(game);
    if (!normalized) return null;
    const story = ensureStoryConfig(normalized);
    const worldSkills = ensureWorldSkills(normalized);
    return {
        id: normalized.id,
        name: normalized.name,
        dmId: normalized.dmId,
        players: normalized.players,
        items: normalized.items,
        gear: normalized.gear,
        demons: normalized.demons,
        demonPool: normalized.demonPool,
        permissions: normalized.permissions,
        invites: normalized.invites,
        story: presentStoryConfig(story, { includeSecrets }),
        worldSkills,
        media: presentMediaState(normalized.media),
    };
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

const GEAR_SLOTS = [
    'weapon',
    'armor',
    'accessory',
    'slot4',
    'slot5',
    'slot6',
    'slot7',
    'slot8',
    'slot9',
    'slot10',
];
const ABILITY_CODES = new Set(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']);
const ABILITY_LIST = Array.from(ABILITY_CODES);

function abilityModifier(score) {
    const num = Number(score);
    if (!Number.isFinite(num)) return 0;
    return Math.floor((num - 10) / 2);
}

function normalizeAbilityScores(raw, fallback = {}) {
    const out = {};
    for (const key of ABILITY_LIST) {
        const source = raw && Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : fallback[key];
        const num = Number(source);
        out[key] = Number.isFinite(num) ? num : 0;
    }
    return out;
}

function deriveAbilityMods(stats) {
    const mods = {};
    for (const key of ABILITY_LIST) {
        mods[key] = abilityModifier(stats?.[key]);
    }
    return mods;
}

function convertLegacyStats(raw) {
    if (!raw || typeof raw !== 'object') {
        return normalizeAbilityScores({});
    }
    const hasModernKeys = ABILITY_LIST.some((key) => Object.prototype.hasOwnProperty.call(raw, key));
    if (hasModernKeys) {
        return normalizeAbilityScores(raw);
    }
    const mapped = {
        STR: raw.STR ?? raw.strength,
        DEX: raw.DEX ?? raw.agility,
        CON: raw.CON ?? raw.endurance,
        INT: raw.INT ?? raw.magic,
        CHA: raw.CHA ?? raw.luck,
    };
    const legacyWis =
        raw.WIS ??
        raw.wisdom ??
        Math.round(((Number(raw.magic) || 0) + (Number(raw.luck) || 0)) / 2);
    mapped.WIS = legacyWis;
    return normalizeAbilityScores(mapped);
}

const DEFAULT_WORLD_SKILLS = [
    { id: 'balance', key: 'balance', label: 'Balance', ability: 'DEX' },
    { id: 'bluff', key: 'bluff', label: 'Bluff', ability: 'CHA' },
    { id: 'climb', key: 'climb', label: 'Climb', ability: 'STR' },
    { id: 'concentration', key: 'concentration', label: 'Concentration', ability: 'CON' },
    { id: 'craftGeneral', key: 'craftGeneral', label: 'Craft (General)', ability: 'INT' },
    { id: 'craftKnowledge', key: 'craftKnowledge', label: 'Craft (Knowledge)', ability: 'INT' },
    { id: 'craftMagic', key: 'craftMagic', label: 'Craft (Magic)', ability: 'INT' },
    { id: 'diplomacy', key: 'diplomacy', label: 'Diplomacy', ability: 'CHA' },
    { id: 'disableDevice', key: 'disableDevice', label: 'Disable Device', ability: 'DEX' },
    { id: 'disguise', key: 'disguise', label: 'Disguise', ability: 'CHA' },
    { id: 'escapeArtist', key: 'escapeArtist', label: 'Escape Artist', ability: 'DEX' },
    { id: 'gatherInformation', key: 'gatherInformation', label: 'Gather Information', ability: 'CHA' },
    { id: 'handleAnimal', key: 'handleAnimal', label: 'Handle Animal', ability: 'CHA' },
    { id: 'heal', key: 'heal', label: 'Heal', ability: 'WIS' },
    { id: 'hide', key: 'hide', label: 'Hide', ability: 'DEX' },
    { id: 'intimidate', key: 'intimidate', label: 'Intimidate', ability: 'CHA' },
    { id: 'jump', key: 'jump', label: 'Jump', ability: 'STR' },
    { id: 'knowledgeArcana', key: 'knowledgeArcana', label: 'Knowledge (Arcana)', ability: 'INT' },
    { id: 'knowledgeReligion', key: 'knowledgeReligion', label: 'Knowledge (Religion)', ability: 'INT' },
    { id: 'knowledgePlanes', key: 'knowledgePlanes', label: 'Knowledge (The Planes)', ability: 'INT' },
    { id: 'listen', key: 'listen', label: 'Listen', ability: 'WIS' },
    { id: 'moveSilently', key: 'moveSilently', label: 'Move Silently', ability: 'DEX' },
    { id: 'negotiation', key: 'negotiation', label: 'Negotiation', ability: 'CHA' },
    { id: 'perform', key: 'perform', label: 'Perform', ability: 'CHA' },
    { id: 'ride', key: 'ride', label: 'Ride', ability: 'DEX' },
    { id: 'senseMotive', key: 'senseMotive', label: 'Sense Motive', ability: 'WIS' },
    { id: 'sleightOfHand', key: 'sleightOfHand', label: 'Sleight of Hand', ability: 'DEX' },
    { id: 'spellcraft', key: 'spellcraft', label: 'Spellcraft', ability: 'INT' },
    { id: 'spot', key: 'spot', label: 'Spot', ability: 'WIS' },
    { id: 'survival', key: 'survival', label: 'Survival', ability: 'WIS' },
    { id: 'swim', key: 'swim', label: 'Swim', ability: 'STR' },
    { id: 'useRope', key: 'useRope', label: 'Use Rope', ability: 'DEX' },
];

function slugifyWorldSkillLabel(label) {
    const base = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return base || `skill-${uuid().slice(0, 8)}`;
}

function normalizeWorldSkillEntry(entry, seen) {
    if (!entry || typeof entry !== 'object') return null;
    const label = sanitizeText(entry.label ?? entry.name).trim();
    if (!label) return null;
    const abilityRaw = typeof entry.ability === 'string' ? entry.ability.trim().toUpperCase() : '';
    const ability = ABILITY_CODES.has(abilityRaw) ? abilityRaw : 'INT';
    let id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : null;
    if (!id && typeof entry.key === 'string' && entry.key.trim()) id = entry.key.trim();
    if (!id) id = slugifyWorldSkillLabel(label);
    let unique = id;
    let suffix = 1;
    while (seen.has(unique)) {
        suffix += 1;
        unique = `${id}-${suffix}`;
    }
    seen.add(unique);
    return { id: unique, key: unique, label, ability };
}

function ensureWorldSkills(game) {
    if (!game || typeof game !== 'object') return [];
    const source = Array.isArray(game.worldSkills) ? game.worldSkills : DEFAULT_WORLD_SKILLS;
    const allowEmpty = Array.isArray(game.worldSkills);
    const seen = new Set();
    const normalized = [];
    for (const entry of source) {
        const skill = normalizeWorldSkillEntry(entry, seen);
        if (skill) normalized.push(skill);
    }
    if (normalized.length === 0 && !allowEmpty) {
        seen.clear();
        for (const entry of DEFAULT_WORLD_SKILLS) {
            const skill = normalizeWorldSkillEntry(entry, seen);
            if (skill) normalized.push(skill);
        }
    }
    game.worldSkills = normalized;
    return normalized;
}

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

async function persistGame(db, game, { reason, actorId, broadcast = true } = {}) {
    if (!db || !game) return;
    saveGame(db, game);
    await writeDB(db);
    if (broadcast && game.id) {
        broadcastGameUpdate(game.id, { reason, actorId });
    }
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

async function deleteDiscordMessage(token, channelId, messageId) {
    if (!token) throw new Error('missing_token');
    if (!channelId || !messageId) throw new Error('invalid_target');
    const url = `${DISCORD_API_BASE}/channels/${channelId}/messages/${messageId}`;
    const res = await fetch(url, {
        method: 'DELETE',
        headers: {
            Authorization: `Bot ${token}`,
            'User-Agent': 'jack-endex/server (+https://example.com)',
        },
    });
    if (res.status === 204) return;
    if (res.status === 404) throw new Error('not_found');
    if (res.status === 403) throw new Error('forbidden');
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`discord_delete_error_${res.status}:${text.slice(0, 120)}`);
    }
}

/**
 * Resolve a persona selection into a Discord username/avatar payload.
 *
 * @param {{ persona?: string, targetUserId?: string }} selection
 * @param {{ db: any, game: ReturnType<typeof ensureGameShape>, actorId: string }} ctx
 */
function describePlayerLabel(player, user) {
    if (!player) return user?.username || 'Player';
    const name = player.character?.name;
    if (typeof name === 'string' && name.trim()) return name.trim();
    if (player?.userId) {
        return user?.username || `Player ${player.userId.slice(0, 6)}`;
    }
    return user?.username || 'Player';
}

function resolveStoryPersona(selection, { db, game, actorId }, options = {}) {
    const story = ensureStoryConfig(game);
    const persona = typeof selection?.persona === 'string' ? selection.persona : 'self';
    const actorIsDM = isDM(game, actorId);
    const actorPlayer = findPlayer(game, actorId);
    const actorUser = findUser(db, actorId);
    const overrideTargetId = options?.overrideTargetId ? parseUUID(options.overrideTargetId) : null;

    const describePlayer = (player, user) => describePlayerLabel(player, user);

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
        if (overrideTargetId) {
            const targetPlayer = findPlayer(game, overrideTargetId);
            if (!targetPlayer) throw new Error('invalid_target');
            const targetUser = findUser(db, overrideTargetId);
            return { username: describePlayer(targetPlayer, targetUser) };
        }

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
    if (existing?.unsubscribe) {
        try {
            existing.unsubscribe();
        } catch {
            // ignore listener cleanup errors
        }
    }
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
        const unsubscribe = watcher.subscribe(() => {
            queueStoryBroadcast(game.id);
        });
        watcher.start();
        storyWatchers.set(game.id, { watcher, signature, unsubscribe });
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

// --- Real-time helpers ---

function getOrCreateSet(map, key) {
    let set = map.get(key);
    if (!set) {
        set = new Set();
        map.set(key, set);
    }
    return set;
}

function sendJson(ws, payload) {
    if (!ws || ws.readyState !== ws.OPEN) return;
    try {
        ws.send(JSON.stringify(payload));
    } catch (err) {
        console.warn('Failed to send websocket payload', err);
    }
}

async function buildStoryPayload(gameId) {
    const db = await readDB();
    const game = getGame(db, gameId);
    if (!game) return null;
    const story = ensureStoryConfig(game);
    const snapshot = getStorySnapshot(game);
    return {
        ...snapshot,
        config: presentStoryConfig(story, { includeSecrets: false }),
        fetchedAt: new Date().toISOString(),
    };
}

async function pushStoryUpdate(gameId) {
    const sockets = storySubscribers.get(gameId);
    if (!sockets || sockets.size === 0) return;
    const payload = await buildStoryPayload(gameId);
    if (!payload) return;
    const message = { type: 'story:update', gameId, snapshot: payload };
    for (const ws of sockets) {
        sendJson(ws, message);
    }
}

function queueStoryBroadcast(gameId, immediate = false) {
    if (!storySubscribers.has(gameId)) return;
    if (storyBroadcastQueue.has(gameId)) return;
    const timer = setTimeout(async () => {
        storyBroadcastQueue.delete(gameId);
        await pushStoryUpdate(gameId);
    }, immediate ? 0 : 150);
    storyBroadcastQueue.set(gameId, timer);
}

async function deliverStorySnapshot(ws, gameId) {
    const payload = await buildStoryPayload(gameId);
    if (!payload) return;
    sendJson(ws, { type: 'story:update', gameId, snapshot: payload });
}

function addSocketForUser(userId, ws) {
    if (!userId) return;
    const set = getOrCreateSet(userSockets, userId);
    set.add(ws);
}

function removeSocketForUser(userId, ws) {
    if (!userId) return;
    const set = userSockets.get(userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
        userSockets.delete(userId);
    }
}

function broadcastGameMessage(gameId, payload) {
    if (!gameId) return;
    const sockets = gameSubscribers.get(gameId);
    if (!sockets || sockets.size === 0) return;
    for (const ws of sockets) {
        sendJson(ws, payload);
    }
}

function broadcastGameUpdate(gameId, extra = {}) {
    if (!gameId) return;
    const payload = {
        type: 'game:update',
        gameId,
        updatedAt: new Date().toISOString(),
    };
    if (extra && extra.reason) payload.reason = extra.reason;
    if (extra && extra.actorId) payload.actorId = extra.actorId;
    broadcastGameMessage(gameId, payload);
}

function broadcastMediaState(game) {
    if (!game || !game.id) return;
    broadcastGameMessage(game.id, {
        type: 'media:state',
        gameId: game.id,
        media: presentMediaState(game.media),
    });
}

function broadcastGameDeleted(gameId) {
    if (!gameId) return;
    broadcastGameMessage(gameId, { type: 'game:deleted', gameId });
}

function subscribeStoryChannel(ws, gameId) {
    if (!ws.storySubscriptions) ws.storySubscriptions = new Set();
    if (!gameId || ws.storySubscriptions.has(gameId)) return;
    ws.storySubscriptions.add(gameId);
    const set = getOrCreateSet(storySubscribers, gameId);
    set.add(ws);
    queueStoryBroadcast(gameId, true);
    deliverStorySnapshot(ws, gameId).catch((err) => {
        console.warn('Failed to send initial story snapshot', err);
    });
}

function subscribeGameChannel(ws, gameId) {
    if (!gameId) return;
    if (!ws.gameSubscriptions) ws.gameSubscriptions = new Set();
    if (ws.gameSubscriptions.has(gameId)) return;
    ws.gameSubscriptions.add(gameId);
    const set = getOrCreateSet(gameSubscribers, gameId);
    set.add(ws);
}

function subscribeTradeChannel(ws, gameId) {
    if (!gameId) return;
    if (!ws.tradeSubscriptions) ws.tradeSubscriptions = new Set();
    ws.tradeSubscriptions.add(gameId);
}

function unsubscribeTradeChannel(ws, gameId) {
    if (!ws.tradeSubscriptions || !gameId) return;
    ws.tradeSubscriptions.delete(gameId);
}

function unsubscribeStoryChannel(ws, gameId) {
    if (!ws.storySubscriptions || !gameId) return;
    ws.storySubscriptions.delete(gameId);
    const set = storySubscribers.get(gameId);
    if (set) {
        set.delete(ws);
        if (set.size === 0) storySubscribers.delete(gameId);
    }
}

function unsubscribeGameChannel(ws, gameId) {
    if (!ws.gameSubscriptions || !gameId) return;
    ws.gameSubscriptions.delete(gameId);
    const set = gameSubscribers.get(gameId);
    if (set) {
        set.delete(ws);
        if (set.size === 0) gameSubscribers.delete(gameId);
    }
}

function cleanupSocket(ws) {
    if (!ws) return;
    if (ws.storySubscriptions) {
        for (const gameId of ws.storySubscriptions) {
            unsubscribeStoryChannel(ws, gameId);
        }
    }
    if (ws.gameSubscriptions) {
        for (const gameId of ws.gameSubscriptions) {
            unsubscribeGameChannel(ws, gameId);
        }
        ws.gameSubscriptions.clear();
    }
    if (ws.tradeSubscriptions) {
        ws.tradeSubscriptions.clear();
    }
    removeSocketForUser(ws.userId, ws);
}

function sendToUser(userId, payload, predicate) {
    const sockets = userSockets.get(userId);
    if (!sockets) return;
    for (const socket of sockets) {
        if (socket.readyState !== socket.OPEN) continue;
        if (typeof predicate === 'function' && !predicate(socket)) continue;
        sendJson(socket, payload);
    }
}

async function loadGameForUser(gameId, userId) {
    const db = await readDB();
    const game = getGame(db, gameId);
    if (!game) return { error: 'not_found' };
    if (!isMember(game, userId)) return { error: 'forbidden' };
    return { db, game };
}

// --- Story impersonation workflow ---

function resolvePersonaRequestStatus(request, status, extra = {}) {
    if (!request) return;
    if (request.timeout) {
        clearTimeout(request.timeout);
    }
    pendingPersonaRequests.delete(request.id);
    const payload = {
        type: 'story:impersonation_status',
        requestId: request.id,
        status,
        gameId: request.gameId,
        targetUserId: request.targetUserId,
        scribeId: request.scribeId,
        content: request.content,
        expiresAt: request.expiresAt,
        createdAt: request.createdAt,
        targetName: request.targetName,
        scribeName: request.scribeName,
    };
    if (extra.reason) payload.reason = extra.reason;
    if (extra.nonce) payload.nonce = extra.nonce;
    if (extra.error) payload.error = extra.error;

    sendToUser(
        request.scribeId,
        payload,
        (socket) => socket.storySubscriptions?.has(request.gameId)
    );
    sendToUser(
        request.targetUserId,
        payload,
        (socket) => socket.storySubscriptions?.has(request.gameId)
    );
}

function expirePersonaRequest(requestId) {
    const request = pendingPersonaRequests.get(requestId);
    if (!request) return;
    resolvePersonaRequestStatus(request, 'expired', { reason: 'Request timed out.' });
}

async function handlePersonaRequestMessage(ws, payload) {
    const nonce = typeof payload?.nonce === 'string' ? payload.nonce : null;
    const gameId = parseUUID(payload?.gameId);
    const targetUserId = parseUUID(payload?.targetUserId);
    if (!gameId || !targetUserId) {
        sendJson(ws, {
            type: 'story:impersonation_status',
            status: 'error',
            nonce,
            error: 'invalid_request',
        });
        return;
    }

    const context = await loadGameForUser(gameId, ws.userId);
    const { game, error } = context;
    const db = context.db;
    if (error) {
        sendJson(ws, {
            type: 'story:impersonation_status',
            status: 'error',
            nonce,
            error,
        });
        return;
    }

    const story = ensureStoryConfig(game);
    if (!story.webhookUrl) {
        sendJson(ws, {
            type: 'story:impersonation_status',
            status: 'error',
            nonce,
            error: 'not_configured',
        });
        return;
    }
    if (!story.scribeIds.includes(ws.userId)) {
        sendJson(ws, {
            type: 'story:impersonation_status',
            status: 'error',
            nonce,
            error: 'forbidden',
        });
        return;
    }

    const trimmed = sanitizeStoryContent(payload?.content);
    if (!trimmed) {
        sendJson(ws, {
            type: 'story:impersonation_status',
            status: 'error',
            nonce,
            error: 'empty_content',
        });
        return;
    }

    if (targetUserId === ws.userId) {
        sendJson(ws, {
            type: 'story:impersonation_status',
            status: 'error',
            nonce,
            error: 'invalid_target',
        });
        return;
    }

    const targetPlayer = findPlayer(game, targetUserId);
    if (!targetPlayer || (targetPlayer.role || '').toLowerCase() === 'dm') {
        sendJson(ws, {
            type: 'story:impersonation_status',
            status: 'error',
            nonce,
            error: 'invalid_target',
        });
        return;
    }

    const targetUser = findUser(db, targetUserId);
    const scribeUser = findUser(db, ws.userId);
    const scribePlayer = findPlayer(game, ws.userId);
    const scribeName = scribePlayer
        ? describePlayerLabel(scribePlayer, scribeUser)
        : scribeUser?.username || 'Scribe';
    const targetName = describePlayerLabel(targetPlayer, targetUser);
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + PERSONA_REQUEST_TIMEOUT_MS).toISOString();
    const requestId = uuid();
    const timeout = setTimeout(() => expirePersonaRequest(requestId), PERSONA_REQUEST_TIMEOUT_MS);

    const request = {
        id: requestId,
        gameId: game.id,
        scribeId: ws.userId,
        targetUserId,
        content: trimmed,
        createdAt,
        expiresAt,
        timeout,
        scribeName,
        targetName,
        gameName: game.name,
    };

    pendingPersonaRequests.set(requestId, request);

    resolvePersonaRequestStatus(request, 'pending', { nonce });

    sendToUser(
        targetUserId,
        {
            type: 'story:impersonation_prompt',
            request: {
                id: request.id,
                gameId: request.gameId,
                scribeId: request.scribeId,
                scribeName,
                content: trimmed,
                createdAt,
                expiresAt,
                gameName: game.name,
                targetName,
            },
        },
        (socket) => socket.storySubscriptions?.has(game.id)
    );
}

async function handlePersonaResponseMessage(ws, payload) {
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId : null;
    if (!requestId) return;
    const request = pendingPersonaRequests.get(requestId);
    if (!request) {
        sendJson(ws, {
            type: 'story:impersonation_status',
            requestId,
            status: 'error',
            error: 'not_found',
        });
        return;
    }
    if (request.targetUserId !== ws.userId) {
        sendJson(ws, {
            type: 'story:impersonation_status',
            requestId,
            status: 'error',
            error: 'forbidden',
        });
        return;
    }

    const approve = !!payload?.approve;

    const { db, game, error } = await loadGameForUser(request.gameId, ws.userId);
    if (error) {
        resolvePersonaRequestStatus(request, 'error', { reason: error });
        return;
    }

    if (!approve) {
        resolvePersonaRequestStatus(request, 'denied', { reason: 'Request denied.' });
        return;
    }

    const story = ensureStoryConfig(game);
    if (!story.webhookUrl) {
        resolvePersonaRequestStatus(request, 'error', { reason: 'Webhook not configured.' });
        return;
    }

    let persona;
    try {
        persona = resolveStoryPersona(
            { persona: 'player', targetUserId: request.targetUserId },
            { db, game, actorId: request.scribeId },
            { overrideTargetId: request.targetUserId }
        );
    } catch (err) {
        resolvePersonaRequestStatus(request, 'error', { reason: err?.message || 'persona_error' });
        return;
    }

    try {
        await sendWebhookMessage(story.webhookUrl, {
            content: request.content,
            username: persona.username,
            avatar_url: persona.avatarUrl || undefined,
        });
    } catch (err) {
        resolvePersonaRequestStatus(request, 'error', {
            reason: err instanceof Error ? err.message : 'webhook_error',
        });
        return;
    }

    const watcherInfo = storyWatchers.get(game.id);
    if (watcherInfo?.watcher?.forceSync) {
        try {
            await watcherInfo.watcher.forceSync();
        } catch (err) {
            console.warn('Failed to force sync story watcher', err);
        }
    }
    queueStoryBroadcast(game.id, true);

    resolvePersonaRequestStatus(request, 'approved');
}

// --- Trade workflow ---

function sanitizeTradeOffer(list) {
    if (!Array.isArray(list)) return [];
    const map = new Map();
    for (const entry of list) {
        if (!entry) continue;
        const itemId = typeof entry.itemId === 'string' ? entry.itemId.trim() : '';
        if (!itemId) continue;
        const quantityRaw = Number(entry.quantity);
        const quantity = Number.isFinite(quantityRaw)
            ? Math.max(1, Math.min(9999, Math.round(quantityRaw)))
            : 1;
        map.set(itemId, (map.get(itemId) || 0) + quantity);
        if (map.size >= 20) break;
    }
    return Array.from(map.entries()).map(([itemId, quantity]) => ({ itemId, quantity }));
}

function buildTradeSnapshot(trade, game, db) {
    const initiatorPlayer = findPlayer(game, trade.initiatorId);
    const initiatorUser = findUser(db, trade.initiatorId);
    const partnerPlayer = findPlayer(game, trade.partnerId);
    const partnerUser = findUser(db, trade.partnerId);

    const mapOffers = (player, offers) => {
        if (!player) return [];
        const inventory = ensureInventoryList(player);
        const index = new Map();
        for (const item of inventory) {
            if (item?.id) index.set(item.id, item);
        }
        return offers.map((entry) => {
            const source = index.get(entry.itemId);
            return {
                itemId: entry.itemId,
                quantity: entry.quantity,
                name: source?.name || 'Item',
                type: source?.type || '',
                desc: source?.desc || '',
            };
        });
    };

    return {
        id: trade.id,
        gameId: trade.gameId,
        initiatorId: trade.initiatorId,
        partnerId: trade.partnerId,
        status: trade.status,
        createdAt: trade.createdAt,
        expiresAt: trade.expiresAt,
        note: trade.note || null,
        participants: {
            [trade.initiatorId]: {
                userId: trade.initiatorId,
                name: describePlayerLabel(initiatorPlayer, initiatorUser),
            },
            [trade.partnerId]: {
                userId: trade.partnerId,
                name: describePlayerLabel(partnerPlayer, partnerUser),
            },
        },
        offers: {
            [trade.initiatorId]: mapOffers(initiatorPlayer, trade.offers[trade.initiatorId] || []),
            [trade.partnerId]: mapOffers(partnerPlayer, trade.offers[trade.partnerId] || []),
        },
        confirmations: { ...trade.confirmations },
    };
}

function refreshTradeTimeout(trade) {
    if (trade.timeout) {
        clearTimeout(trade.timeout);
    }
    trade.expiresAt = new Date(Date.now() + TRADE_TIMEOUT_MS).toISOString();
    trade.timeout = setTimeout(() => {
        cancelTrade(trade, 'timeout').catch((err) => console.warn('trade timeout cancel failed', err));
    }, TRADE_TIMEOUT_MS);
}

async function sendTradeMessage(trade, type, extra = {}) {
    const db = await readDB();
    const game = getGame(db, trade.gameId);
    if (!game) return;
    const snapshot = buildTradeSnapshot(trade, game, db);
    const payload = { type, trade: snapshot, ...extra };
    const filter = (socket) => socket.tradeSubscriptions?.has(trade.gameId);
    sendToUser(trade.initiatorId, payload, filter);
    sendToUser(trade.partnerId, payload, filter);
}

async function cancelTrade(trade, reason = 'cancelled') {
    if (!trade) return;
    if (trade.timeout) clearTimeout(trade.timeout);
    trade.status = 'cancelled';
    pendingTrades.delete(trade.id);
    await sendTradeMessage(trade, 'trade:cancelled', { reason });
}

async function finalizeTrade(trade) {
    const db = await readDB();
    const game = getGame(db, trade.gameId);
    if (!game) {
        await cancelTrade(trade, 'game_missing');
        return;
    }
    const giver = findPlayer(game, trade.initiatorId);
    const receiver = findPlayer(game, trade.partnerId);
    if (!giver || !receiver) {
        await cancelTrade(trade, 'player_missing');
        return;
    }

    const prepareEntries = (player, offers) => {
        const inventory = ensureInventoryList(player);
        const index = new Map();
        for (const item of inventory) {
            if (item?.id) index.set(item.id, item);
        }
        const prepared = [];
        for (const offer of offers) {
            const source = index.get(offer.itemId);
            if (!source) {
                return { error: 'missing_item', itemId: offer.itemId };
            }
            const amountRaw = Number(source.amount);
            const available = Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : 1;
            if (offer.quantity > available) {
                return { error: 'insufficient_quantity', itemId: offer.itemId };
            }
            prepared.push({ item: source, quantity: Math.max(1, Math.min(offer.quantity, available)) });
        }
        return { entries: prepared };
    };

    const giverEntries = prepareEntries(giver, trade.offers[trade.initiatorId] || []);
    if (giverEntries.error) {
        await cancelTrade(trade, giverEntries.error);
        return;
    }
    const receiverEntries = prepareEntries(receiver, trade.offers[trade.partnerId] || []);
    if (receiverEntries.error) {
        await cancelTrade(trade, receiverEntries.error);
        return;
    }

    const transfer = (fromPlayer, toPlayer, entries) => {
        const fromInventory = ensureInventoryList(fromPlayer);
        const toInventory = ensureInventoryList(toPlayer);
        for (const entry of entries) {
            const idx = fromInventory.findIndex((it) => it && it.id === entry.item.id);
            if (idx === -1) continue;
            const source = fromInventory[idx];
            const qty = entry.quantity;
            const amountRaw = Number(source.amount);
            const available = Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : 1;
            if (available > qty) {
                source.amount = available - qty;
                const clone = {
                    id: uuid(),
                    name: source.name,
                    type: source.type,
                    desc: source.desc,
                    amount: qty,
                };
                toInventory.push(clone);
            } else {
                const removed = fromInventory.splice(idx, 1)[0];
                const clone = {
                    id: uuid(),
                    name: removed.name,
                    type: removed.type,
                    desc: removed.desc,
                };
                if (available > 1) clone.amount = available;
                toInventory.push(clone);
            }
        }
    };

    transfer(giver, receiver, giverEntries.entries);
    transfer(receiver, giver, receiverEntries.entries);

    await persistGame(db, game, { reason: 'trade:completed' });

    if (trade.timeout) clearTimeout(trade.timeout);
    trade.status = 'completed';
    pendingTrades.delete(trade.id);

    await sendTradeMessage(trade, 'trade:completed');
}

async function handleTradeStart(ws, payload) {
    const gameId = parseUUID(payload?.gameId);
    const partnerId = parseUUID(payload?.partnerId);
    if (!gameId || !partnerId || partnerId === ws.userId) {
        sendJson(ws, { type: 'trade:error', error: 'invalid_request' });
        return;
    }
    const { game, error } = await loadGameForUser(gameId, ws.userId);
    if (error) {
        sendJson(ws, { type: 'trade:error', error });
        return;
    }
    const actorPlayer = findPlayer(game, ws.userId);
    const partnerPlayer = findPlayer(game, partnerId);
    if (!actorPlayer || (actorPlayer.role || '').toLowerCase() === 'dm') {
        sendJson(ws, { type: 'trade:error', error: 'initiator_not_player' });
        return;
    }
    if (!partnerPlayer || (partnerPlayer.role || '').toLowerCase() === 'dm') {
        sendJson(ws, { type: 'trade:error', error: 'partner_not_player' });
        return;
    }

    const note = typeof payload?.note === 'string' ? payload.note.slice(0, 200) : '';
    const tradeId = uuid();
    const trade = {
        id: tradeId,
        gameId: game.id,
        initiatorId: ws.userId,
        partnerId,
        status: 'awaiting-partner',
        offers: {
            [ws.userId]: [],
            [partnerId]: [],
        },
        confirmations: {
            [ws.userId]: false,
            [partnerId]: false,
        },
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + TRADE_TIMEOUT_MS).toISOString(),
        note,
    };
    trade.timeout = setTimeout(() => {
        cancelTrade(trade, 'timeout').catch((err) => console.warn('trade timeout cancel failed', err));
    }, TRADE_TIMEOUT_MS);

    pendingTrades.set(tradeId, trade);

    refreshTradeTimeout(trade);
    await sendTradeMessage(trade, 'trade:invite', { initiatedBy: ws.userId });
}

async function handleTradeRespond(ws, payload) {
    const tradeId = typeof payload?.tradeId === 'string' ? payload.tradeId : null;
    if (!tradeId) return;
    const trade = pendingTrades.get(tradeId);
    if (!trade) {
        sendJson(ws, { type: 'trade:error', error: 'not_found', tradeId });
        return;
    }
    if (trade.partnerId !== ws.userId) {
        sendJson(ws, { type: 'trade:error', error: 'forbidden', tradeId });
        return;
    }
    if (trade.status !== 'awaiting-partner') {
        return;
    }
    const accept = !!payload?.accept;
    if (!accept) {
        await cancelTrade(trade, 'declined');
        return;
    }
    trade.status = 'active';
    trade.confirmations[trade.initiatorId] = false;
    trade.confirmations[trade.partnerId] = false;
    refreshTradeTimeout(trade);
    await sendTradeMessage(trade, 'trade:active');
}

async function handleTradeUpdate(ws, payload) {
    const tradeId = typeof payload?.tradeId === 'string' ? payload.tradeId : null;
    if (!tradeId) return;
    const trade = pendingTrades.get(tradeId);
    if (!trade) {
        sendJson(ws, { type: 'trade:error', error: 'not_found', tradeId });
        return;
    }
    if (trade.status !== 'active') return;
    if (ws.userId !== trade.initiatorId && ws.userId !== trade.partnerId) {
        sendJson(ws, { type: 'trade:error', error: 'forbidden', tradeId });
        return;
    }

    const sanitized = sanitizeTradeOffer(payload?.items);
    trade.offers[ws.userId] = sanitized;
    trade.confirmations[trade.initiatorId] = false;
    trade.confirmations[trade.partnerId] = false;
    refreshTradeTimeout(trade);
    await sendTradeMessage(trade, 'trade:update');
}

async function handleTradeConfirm(ws, payload) {
    const tradeId = typeof payload?.tradeId === 'string' ? payload.tradeId : null;
    if (!tradeId) return;
    const trade = pendingTrades.get(tradeId);
    if (!trade || trade.status !== 'active') return;
    if (ws.userId !== trade.initiatorId && ws.userId !== trade.partnerId) return;
    trade.confirmations[ws.userId] = true;
    refreshTradeTimeout(trade);
    await sendTradeMessage(trade, 'trade:update');
    if (trade.confirmations[trade.initiatorId] && trade.confirmations[trade.partnerId]) {
        await finalizeTrade(trade);
    }
}

async function handleTradeUnconfirm(ws, payload) {
    const tradeId = typeof payload?.tradeId === 'string' ? payload.tradeId : null;
    if (!tradeId) return;
    const trade = pendingTrades.get(tradeId);
    if (!trade || trade.status !== 'active') return;
    if (ws.userId !== trade.initiatorId && ws.userId !== trade.partnerId) return;
    trade.confirmations[ws.userId] = false;
    refreshTradeTimeout(trade);
    await sendTradeMessage(trade, 'trade:update');
}

async function handleTradeCancel(ws, payload) {
    const tradeId = typeof payload?.tradeId === 'string' ? payload.tradeId : null;
    if (!tradeId) return;
    const trade = pendingTrades.get(tradeId);
    if (!trade) return;
    if (ws.userId !== trade.initiatorId && ws.userId !== trade.partnerId) return;
    await cancelTrade(trade, 'cancelled');
}

async function sendOpenTradesToSocket(ws, gameId) {
    const relevant = Array.from(pendingTrades.values()).filter(
        (trade) =>
            trade.gameId === gameId &&
            (trade.initiatorId === ws.userId || trade.partnerId === ws.userId) &&
            trade.status !== 'completed' &&
            trade.status !== 'cancelled'
    );
    if (relevant.length === 0) return;
    const db = await readDB();
    const game = getGame(db, gameId);
    if (!game) return;
    for (const trade of relevant) {
        const snapshot = buildTradeSnapshot(trade, game, db);
        const type = trade.status === 'awaiting-partner' ? 'trade:invite' : 'trade:active';
        sendJson(ws, { type, trade: snapshot });
    }
}

async function handleSocketMessage(ws, data) {
    let message;
    try {
        message = typeof data === 'string' ? JSON.parse(data) : JSON.parse(data.toString('utf8'));
    } catch {
        return;
    }
    if (!message || typeof message !== 'object') return;

    const type = message.type;
    try {
        switch (type) {
            case 'subscribe': {
                const channel = message.channel;
                const gameId = parseUUID(message.gameId);
                if (!gameId) break;
                if (channel === 'story') {
                    subscribeStoryChannel(ws, gameId);
                } else if (channel === 'trade') {
                    subscribeTradeChannel(ws, gameId);
                    await sendOpenTradesToSocket(ws, gameId);
                } else if (channel === 'game') {
                    subscribeGameChannel(ws, gameId);
                }
                break;
            }
            case 'unsubscribe': {
                const channel = message.channel;
                const gameId = parseUUID(message.gameId);
                if (!gameId) break;
                if (channel === 'story') {
                    unsubscribeStoryChannel(ws, gameId);
                } else if (channel === 'trade') {
                    unsubscribeTradeChannel(ws, gameId);
                } else if (channel === 'game') {
                    unsubscribeGameChannel(ws, gameId);
                }
                break;
            }
            case 'story.impersonation.request':
                await handlePersonaRequestMessage(ws, message);
                break;
            case 'story.impersonation.respond':
                await handlePersonaResponseMessage(ws, message);
                break;
            case 'trade.start':
                await handleTradeStart(ws, message);
                break;
            case 'trade.respond':
                await handleTradeRespond(ws, message);
                break;
            case 'trade.update':
                await handleTradeUpdate(ws, message);
                break;
            case 'trade.confirm':
                await handleTradeConfirm(ws, message);
                break;
            case 'trade.unconfirm':
                await handleTradeUnconfirm(ws, message);
                break;
            case 'trade.cancel':
                await handleTradeCancel(ws, message);
                break;
            case 'media.play': {
                const gameId = parseUUID(message.gameId);
                const rawUrl = typeof message.url === 'string' ? message.url : '';
                if (!gameId || !rawUrl) {
                    sendJson(ws, { type: 'media:error', error: 'invalid_request', gameId: gameId || null });
                    break;
                }
                const parsed = parseYouTubeInput(rawUrl);
                if (!parsed) {
                    sendJson(ws, { type: 'media:error', error: 'invalid_url', gameId });
                    break;
                }
                const db = await readDB();
                const game = getGame(db, gameId);
                if (!game || !isMember(game, ws.userId)) {
                    sendJson(ws, { type: 'media:error', error: 'not_found', gameId });
                    break;
                }
                if (!isDM(game, ws.userId)) {
                    sendJson(ws, { type: 'media:error', error: 'forbidden', gameId });
                    break;
                }
                const media = ensureMediaState(game);
                media.url = parsed.url;
                media.videoId = parsed.videoId;
                media.startSeconds = parsed.startSeconds;
                media.playing = true;
                media.updatedAt = new Date().toISOString();
                await persistGame(db, game, { broadcast: false });
                broadcastMediaState(game);
                break;
            }
            case 'media.stop': {
                const gameId = parseUUID(message.gameId);
                if (!gameId) break;
                const db = await readDB();
                const game = getGame(db, gameId);
                if (!game || !isMember(game, ws.userId)) {
                    sendJson(ws, { type: 'media:error', error: 'not_found', gameId: gameId || null });
                    break;
                }
                if (!isDM(game, ws.userId)) {
                    sendJson(ws, { type: 'media:error', error: 'forbidden', gameId });
                    break;
                }
                const media = ensureMediaState(game);
                media.url = '';
                media.videoId = '';
                media.startSeconds = 0;
                media.playing = false;
                media.updatedAt = new Date().toISOString();
                await persistGame(db, game, { broadcast: false });
                broadcastMediaState(game);
                break;
            }
            case 'alert.broadcast': {
                const gameId = parseUUID(message.gameId);
                const text = sanitizeAlertMessage(message.message);
                if (!gameId || !text) {
                    sendJson(ws, { type: 'alert:error', error: 'invalid_message', gameId: gameId || null });
                    break;
                }
                const db = await readDB();
                const game = getGame(db, gameId);
                if (!game || !isMember(game, ws.userId)) {
                    sendJson(ws, { type: 'alert:error', error: 'not_found', gameId });
                    break;
                }
                if (!isDM(game, ws.userId)) {
                    sendJson(ws, { type: 'alert:error', error: 'forbidden', gameId });
                    break;
                }
                const user = findUser(db, ws.userId);
                const alert = {
                    id: uuid(),
                    message: text,
                    issuedAt: new Date().toISOString(),
                    senderId: ws.userId,
                    senderName: user?.username || 'DM',
                };
                broadcastGameMessage(gameId, { type: 'alert:show', gameId, alert });
                break;
            }
            default:
                sendJson(ws, { type: 'error', error: 'unknown_type', originalType: type });
        }
    } catch (err) {
        console.warn('Websocket handler error', err);
        sendJson(ws, { type: 'error', error: 'internal_error' });
    }
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
        const path = url.pathname;
        const webhookPattern = /^\/api(?:\/v\d+)?\/webhooks\//;
        if (!webhookPattern.test(path)) return '';
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

const sessionParser = session({
    secret: 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        sameSite: 'lax', // 'lax' works for http://localhost:5173 -> http://localhost:3000
        secure: false, // set true only behind https
    },
});

app.use(sessionParser);

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
    ensureWorldSkills(game);
    db.games.push(game);
    await writeDB(db);
    res.json(presentGame(game, { includeSecrets: true }));
});

app.get('/api/games/:id', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const g = getGame(db, id);
    if (!g || !isMember(g, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }

    const includeSecrets = isDM(g, req.session.userId);
    res.json(presentGame(g, { includeSecrets }));
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
    await persistGame(db, game);
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

    await persistGame(db, game);
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
    await persistGame(db, game);
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
    await persistGame(db, game);
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

    await persistGame(db, game);
    res.json({ ok: true });
});

// --- World skills ---
app.post('/api/games/:id/world-skills', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const list = ensureWorldSkills(game);
    const payload = req.body?.skill || req.body || {};
    const seen = new Set(list.map((skill) => skill.id));
    const entry = normalizeWorldSkillEntry(payload, seen);
    if (!entry) {
        return res.status(400).json({ error: 'invalid_skill' });
    }

    list.push(entry);
    if (Array.isArray(game.players)) {
        for (const player of game.players) {
            if (!player || !player.character) continue;
            if (!player.character.skills || typeof player.character.skills !== 'object') {
                player.character.skills = {};
            }
            if (!player.character.skills[entry.id]) {
                player.character.skills[entry.id] = { ranks: 0, misc: 0 };
            }
        }
    }

    await persistGame(db, game, { reason: 'worldSkill:add', actorId: req.session.userId });
    res.json(entry);
});

app.put('/api/games/:id/world-skills/:skillId', requireAuth, async (req, res) => {
    const { id, skillId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const list = ensureWorldSkills(game);
    const idx = list.findIndex((skill) => skill && skill.id === skillId);
    if (idx === -1) {
        return res.status(404).json({ error: 'skill_not_found' });
    }

    const payload = req.body?.skill || req.body || {};
    const target = list[idx];
    let changed = false;
    const hasLabelField =
        Object.prototype.hasOwnProperty.call(payload, 'label') ||
        Object.prototype.hasOwnProperty.call(payload, 'name');
    if (hasLabelField) {
        const nextLabel = sanitizeText(payload.label ?? payload.name).trim();
        if (!nextLabel) {
            return res.status(400).json({ error: 'invalid_label' });
        }
        if (nextLabel !== target.label) {
            target.label = nextLabel;
            changed = true;
        }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'ability')) {
        const abilityRaw = typeof payload.ability === 'string' ? payload.ability.trim().toUpperCase() : '';
        if (!ABILITY_CODES.has(abilityRaw)) {
            return res.status(400).json({ error: 'invalid_ability' });
        }
        if (abilityRaw !== target.ability) {
            target.ability = abilityRaw;
            changed = true;
        }
    }

    if (!changed) {
        return res.status(400).json({ error: 'no_changes' });
    }

    await persistGame(db, game, { reason: 'worldSkill:update', actorId: req.session.userId });
    res.json(target);
});

app.delete('/api/games/:id/world-skills/:skillId', requireAuth, async (req, res) => {
    const { id, skillId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const list = ensureWorldSkills(game);
    const next = list.filter((skill) => skill && skill.id !== skillId);
    if (next.length === list.length) {
        return res.status(404).json({ error: 'skill_not_found' });
    }
    game.worldSkills = next;

    if (Array.isArray(game.players)) {
        for (const player of game.players) {
            if (!player?.character || typeof player.character.skills !== 'object') continue;
            delete player.character.skills[skillId];
        }
    }

    await persistGame(db, game, { reason: 'worldSkill:delete', actorId: req.session.userId });
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
    broadcastGameDeleted(gameId);
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
    await persistGame(db, game);
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
    await persistGame(db, game);
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
    await persistGame(db, game);
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
    await persistGame(db, game);
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

    await persistGame(db, game);
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
    await persistGame(db, game);
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

    await persistGame(db, game);
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

    await persistGame(db, game);
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

    await persistGame(db, game);
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
            await persistGame(db, game);
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

    await persistGame(db, game);
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
    await persistGame(db, game);
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
    await persistGame(db, game);
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
    await persistGame(db, game);
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
    await persistGame(db, game);
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
    const stats = convertLegacyStats(body.stats);
    const demon = {
        id: uuid(),
        name: sanitizeText(body.name),
        arcana: sanitizeText(body.arcana),
        alignment: sanitizeText(body.alignment),
        level: Number(body.level) || 0,
        stats,
        mods: deriveAbilityMods(stats),
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
    await persistGame(db, game);
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
    const baseStats = convertLegacyStats(current.stats);
    const stats =
        body.stats !== undefined
            ? normalizeAbilityScores(convertLegacyStats(body.stats), baseStats)
            : baseStats;

    const updated = {
        ...current,
        name: sanitizeText(body.name ?? current.name),
        arcana: sanitizeText(body.arcana ?? current.arcana),
        alignment: sanitizeText(body.alignment ?? current.alignment),
        level: Number(body.level ?? current.level) || 0,
        stats,
        mods: deriveAbilityMods(stats),
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
    await persistGame(db, game);
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
    await persistGame(db, game);
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

const storyConfigRouter = express.Router({ mergeParams: true });

storyConfigRouter.use(requireAuth);

storyConfigRouter.put('/', async (req, res) => {
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
    await persistGame(db, game);

    res.json({
        ok: true,
        story: presentStoryConfig(game.story, { includeSecrets: true }),
    });
});

app.use('/api/games/:id/story-config', storyConfigRouter);

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

    const personaType = typeof req.body?.persona === 'string' ? req.body.persona : null;
    const targetUserId = typeof req.body?.targetUserId === 'string' ? parseUUID(req.body.targetUserId) : null;
    if (!actorIsDM && personaType === 'player' && targetUserId && targetUserId !== actorId) {
        return res.status(409).json({ error: 'approval_required' });
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

    const watcherInfo = getOrCreateStoryWatcher(game);
    if (watcherInfo?.forceSync) {
        try {
            await watcherInfo.forceSync();
        } catch (err) {
            console.warn('Failed to force sync after post', err);
        }
    }
    queueStoryBroadcast(game.id, true);

    res.status(201).json({ ok: true });
});

app.delete('/api/games/:id/story-log/messages/:messageId', requireAuth, async (req, res) => {
    const { id, messageId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const story = ensureStoryConfig(game);
    const token = story.botToken || getDiscordBotToken();
    if (!token || !story.channelId) {
        return res.status(400).json({ error: 'not_configured' });
    }

    try {
        await deleteDiscordMessage(token, story.channelId, messageId);
    } catch (err) {
        const message = err instanceof Error ? err.message : 'delete_failed';
        if (message === 'not_found') {
            return res.status(404).json({ error: 'message_not_found' });
        }
        if (message === 'forbidden') {
            return res.status(403).json({ error: 'discord_forbidden' });
        }
        if (message === 'missing_token' || message === 'invalid_target') {
            return res.status(400).json({ error: message });
        }
        console.warn('Failed to delete Discord message', err);
        return res.status(502).json({ error: 'discord_error' });
    }

    const watcher = getOrCreateStoryWatcher(game);
    if (watcher?.forceSync) {
        try {
            await watcher.forceSync();
        } catch (err) {
            console.warn('Failed to force sync after deletion', err);
        }
    }
    queueStoryBroadcast(game.id, true);

    res.json({ ok: true });
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

app.get('/api/help/docs', async (_req, res) => {
    try {
        const entries = await fs.readdir(TXT_DOCS_PATH);
        const docs = entries
            .filter((name) => typeof name === 'string' && name.toLowerCase().endsWith('.txt'))
            .sort((a, b) => a.localeCompare(b))
            .map((name) => ({
                name,
                filename: name,
                url: `/txtdocs/${encodeURIComponent(name)}`,
            }));
        res.json(docs);
    } catch {
        res.json([]);
    }
});

// Persona proxy routes
app.use('/api/personas', personas);

// Static files (if built)
app.use('/txtdocs', express.static(TXT_DOCS_PATH));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'dist')));

if (SPA_INDEX) {
    app.get(['/join/:code', '/game/:id', '/game/:id/*'], (_req, res) => {
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

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const HEARTBEAT_INTERVAL_MS = 30_000;
const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
        if (ws.isAlive === false) {
            cleanupSocket(ws);
            try {
                ws.terminate();
            } catch {
                // ignore termination errors
            }
            continue;
        }
        ws.isAlive = false;
        try {
            ws.ping();
        } catch {
            // ignore ping errors
        }
    }
}, HEARTBEAT_INTERVAL_MS);

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.gameSubscriptions = ws.gameSubscriptions || new Set();
    addSocketForUser(ws.userId, ws);
    ws.on('message', (data) => {
        handleSocketMessage(ws, data);
    });
    ws.on('pong', () => {
        ws.isAlive = true;
    });
    ws.on('close', () => {
        cleanupSocket(ws);
    });
    ws.on('error', () => {
        cleanupSocket(ws);
    });
    sendJson(ws, { type: 'welcome', userId: ws.userId });
});

wss.on('close', () => clearInterval(heartbeat));

server.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith('/ws')) {
        socket.destroy();
        return;
    }

    sessionParser(req, {}, () => {
        if (!req.session || !req.session.userId) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
            ws.userId = req.session.userId;
            ws.storySubscriptions = ws.storySubscriptions || new Set();
            ws.tradeSubscriptions = ws.tradeSubscriptions || new Set();
            ws.gameSubscriptions = ws.gameSubscriptions || new Set();
            wss.emit('connection', ws, req);
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`server listening on ${PORT}`));
