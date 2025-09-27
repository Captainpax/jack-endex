/* eslint-env node */
import http from 'http';
import express from 'express';
import session from 'express-session';
import { WebSocketServer } from 'ws';
import { v4 as uuid } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import mongoose from './lib/mongoose.js';
import MongoSessionStore from './lib/mongoSessionStore.js';
import { fileURLToPath } from 'url';
import cors from 'cors';

import personas from './routes/personas.routes.js';
import { createDiscordWatcher } from './discordWatcher.js';
import { loadEnv, envString, envNumber, envBoolean } from './config/env.js';
import User from './models/User.js';
import Game from './models/Game.js';
import Demon from './models/Demon.js';
import Item from './models/Item.js';
import { loadDemonEntries } from './lib/demonImport.js';
import { loadItemEntries, parseHealingEffect } from './lib/itemImport.js';
import { DEFAULT_WORLD_SKILLS } from '../shared/worldSkills.js';
import { MUSIC_TRACKS, getMusicTrack } from '../shared/music/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLIC_PATH = path.join(PROJECT_ROOT, 'public');
const DIST_PATH = path.join(PROJECT_ROOT, 'dist');
const SHARED_PATH = path.join(PROJECT_ROOT, 'shared');
const storyWatchers = new Map();
const storyWatcherSkipReasons = new Map();
const storySubscribers = new Map();
const gameSubscribers = new Map();
const gamePresence = new Map();
const userSockets = new Map();
const pendingPersonaRequests = new Map();
const pendingTrades = new Map();
const storyBroadcastQueue = new Map();
const DISCORD_API_BASE = 'https://discord.com/api/v10';
const readiness = {
    db: false,
    discord: false,
    server: false,
    ready: false,
};

function updateReadiness() {
    readiness.ready = readiness.db && readiness.discord && readiness.server;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
const PERSONA_REQUEST_TIMEOUT_MS = 120_000;
const TRADE_TIMEOUT_MS = 180_000;
const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const MAX_ALERT_LENGTH = 500;
const HEX_COLOR_REGEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const MAX_MAP_STROKES = 800;
const MAX_MAP_POINTS_PER_STROKE = 600;
const MAX_MAP_LIBRARY_ENTRIES = 24;
const MAX_MAP_SHAPES = 80;
const MUSIC_TRACK_IDS = new Set(MUSIC_TRACKS.map((track) => track.id));
const DEFAULT_STROKE_COLOR = '#f97316';
const DEFAULT_PLAYER_TOKEN_COLOR = '#38bdf8';
const DEFAULT_DEMON_TOKEN_COLOR = '#f97316';
const DEFAULT_CUSTOM_TOKEN_COLOR = '#a855f7';
const DEFAULT_ENEMY_TOKEN_COLOR = '#ef4444';
const DEFAULT_SHAPE_FILL = '#1e293b';
const DEFAULT_SHAPE_STROKE = '#f8fafc';
const DEFAULT_SHAPE_STROKE_WIDTH = 2;
const DEFAULT_SHAPE_OPACITY = 0.6;
const DEFAULT_BACKGROUND_SCALE = 1;
const DEFAULT_BACKGROUND_OPACITY = 1;
const MAP_SHAPE_TYPES = new Set(['rectangle', 'circle', 'line', 'diamond', 'triangle', 'cone', 'image']);
const MIN_SHAPE_SIZE = 0.02;
const DEFAULT_DB_PATH = path.join(__dirname, 'data', 'db.json');
let legacySeedPromise = null;

await loadEnv({ root: PROJECT_ROOT });

mongoose.set('strictQuery', false);

const MONGODB_URI = envString('MONGODB_URI');
const MONGODB_DB_NAME = envString('MONGODB_DB_NAME');
if (!MONGODB_URI) {
    console.error('Missing MONGODB_URI environment variable. Set it in .env to connect to MongoDB.');
    process.exit(1);
}

const DB_CONNECT_MAX_ATTEMPTS = Math.max(1, envNumber('MONGODB_CONNECT_MAX_ATTEMPTS', 5) || 5);
const DB_CONNECT_RETRY_DELAY_MS = Math.max(500, envNumber('MONGODB_CONNECT_RETRY_MS', 2000) || 2000);

const SESSION_SECRET = envString('SESSION_SECRET', 'dev-secret');
const RAW_CORS_ORIGINS = envString('CORS_ORIGINS', 'https://jack-endex.darkmatterservers.com');
const ALLOWED_ORIGINS = RAW_CORS_ORIGINS
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => origin.replace(/\/$/, ''));
const ALLOW_ALL_ORIGINS = ALLOWED_ORIGINS.includes('*');

function isOriginAllowed(origin) {
    if (!origin) return true;
    if (ALLOW_ALL_ORIGINS) return true;
    const normalized = origin.replace(/\/$/, '');
    return ALLOWED_ORIGINS.includes(normalized);
}

const TRUST_PROXY = envString('TRUST_PROXY', '').trim();
const SESSION_COOKIE_SECURE = envBoolean(
    'SESSION_COOKIE_SECURE',
    process.env.NODE_ENV === 'production',
);
const SESSION_COLLECTION = envString('SESSION_COLLECTION', 'sessions');
const SESSION_TTL_SECONDS = (() => {
    const raw = envNumber('SESSION_TTL_SECONDS', 60 * 60 * 24 * 7);
    if (!Number.isFinite(raw)) return 60 * 60 * 24 * 7;
    if (raw <= 0) return 60 * 60 * 24 * 7;
    return Math.floor(raw);
})();
const SESSION_COOKIE_DOMAIN = envString('SESSION_COOKIE_DOMAIN', '').trim();
const SESSION_COOKIE_SAME_SITE = (() => {
    const raw = envString(
        'SESSION_COOKIE_SAME_SITE',
        SESSION_COOKIE_SECURE ? 'none' : 'lax',
    ).toLowerCase();
    if (['lax', 'strict', 'none'].includes(raw)) return raw;
    return SESSION_COOKIE_SECURE ? 'none' : 'lax';
})();
const DEFAULT_DISCORD_BOT_TOKEN = readBotToken(
    envString('DISCORD_PRIMARY_BOT_TOKEN') ||
    envString('DISCORD_DEFAULT_BOT_TOKEN') ||
    envString('DISCORD_BOT_TOKEN') ||
    envString('BOT_TOKEN')
);
const DEFAULT_DISCORD_INVITE = envString('DISCORD_PRIMARY_BOT_INVITE') || envString('DISCORD_BOT_INVITE');
const DEFAULT_DISCORD_APPLICATION_ID = envString('DISCORD_APPLICATION_ID');
const DEFAULT_DISCORD_GUILD_ID = envString('DISCORD_PRIMARY_GUILD_ID')
    || envString('DISCORD_GUILD_ID')
    || envString('DISCORD_SERVER_ID');
const DEFAULT_DISCORD_CHANNEL_ID = envString('DISCORD_PRIMARY_CHANNEL_ID') || envString('DISCORD_CHANNEL_ID');
const DEFAULT_DISCORD_POLL_INTERVAL_MS = envNumber('DISCORD_POLL_INTERVAL_MS', 15_000) || 15_000;
const PRIMARY_DISCORD_INFO = {
    available: !!DEFAULT_DISCORD_BOT_TOKEN,
    inviteUrl: DEFAULT_DISCORD_INVITE || null,
    applicationId: DEFAULT_DISCORD_APPLICATION_ID || null,
    defaultGuildId: readSnowflake(DEFAULT_DISCORD_GUILD_ID) || null,
    defaultChannelId: readSnowflake(DEFAULT_DISCORD_CHANNEL_ID) || null,
    pollIntervalMs: DEFAULT_DISCORD_POLL_INTERVAL_MS,
};
const DISCORD_STARTUP_MAX_ATTEMPTS = Math.max(1, envNumber('DISCORD_STARTUP_MAX_ATTEMPTS', 3) || 3);
const DISCORD_STARTUP_RETRY_DELAY_MS = Math.max(1_000, envNumber('DISCORD_STARTUP_RETRY_MS', 2_000) || 2_000);

mongoose.connection.on('connected', () => {
    readiness.db = true;
    updateReadiness();
});

mongoose.connection.on('disconnected', () => {
    readiness.db = false;
    updateReadiness();
    console.warn('[db] Lost connection to MongoDB.');
});

mongoose.connection.on('reconnected', () => {
    readiness.db = true;
    updateReadiness();
    console.log('[db] Reconnected to MongoDB.');
});

mongoose.connection.on('error', (err) => {
    console.error('[db] MongoDB connection error:', err);
});

async function connectToDatabaseWithRetry(
    uri,
    options = {},
    { attempts = DB_CONNECT_MAX_ATTEMPTS, delayMs = DB_CONNECT_RETRY_DELAY_MS } = {}
) {
    const totalAttempts = Math.max(1, Math.floor(attempts));
    const baseDelay = Math.max(500, Math.floor(delayMs));
    let lastError = null;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
        try {
            await mongoose.connect(uri, options);
            console.log(`[db] Connected to MongoDB (attempt ${attempt}/${totalAttempts}).`);
            readiness.db = true;
            updateReadiness();
            return;
        } catch (err) {
            lastError = err;
            readiness.db = false;
            updateReadiness();
            console.error(`[db] MongoDB connection attempt ${attempt} failed:`, err);
            if (attempt >= totalAttempts) break;
            const waitMs = Math.min(baseDelay * 2 ** (attempt - 1), 30_000);
            console.log(`[db] Retrying MongoDB connection in ${waitMs}ms…`);
            await delay(waitMs);
        }
    }

    throw lastError ?? new Error('Failed to connect to MongoDB.');
}

async function ensureDiscordBotOnline({
    retries = DISCORD_STARTUP_MAX_ATTEMPTS,
    delayMs = DISCORD_STARTUP_RETRY_DELAY_MS,
} = {}) {
    const token = getDiscordBotToken();
    if (!token) {
        console.log('[discord] No Discord bot token configured; skipping availability check.');
        readiness.discord = true;
        updateReadiness();
        return;
    }

    if (typeof globalThis.fetch !== 'function') {
        console.warn('[discord] fetch API not available in this runtime; skipping availability check.');
        readiness.discord = true;
        updateReadiness();
        return;
    }

    const totalAttempts = Math.max(1, Math.floor(retries));
    const baseDelay = Math.max(1_000, Math.floor(delayMs));
    let lastError = null;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
        try {
            const res = await globalThis.fetch(`${DISCORD_API_BASE}/users/@me`, {
                method: 'GET',
                headers: {
                    Authorization: `Bot ${token}`,
                    'User-Agent': 'jack-endex/startup-check (+https://jack-endex.app)',
                    Accept: 'application/json',
                },
            });

            if (res.status === 401) {
                throw new Error('Discord rejected the bot token (401 Unauthorized).');
            }
            if (!res.ok) {
                let detail = '';
                try {
                    detail = await res.text();
                } catch {
                    // ignore body parsing errors
                }
                const snippet = detail ? `: ${detail.slice(0, 200)}` : '';
                throw new Error(`Discord API responded with ${res.status}${snippet}`);
            }

            let identity = null;
            try {
                identity = await res.json();
            } catch {
                identity = null;
            }

            const username = identity?.username || 'bot';
            const discriminator =
                identity?.discriminator && identity.discriminator !== '0'
                    ? `#${identity.discriminator}`
                    : '';
            console.log(`[discord] Bot ready as ${username}${discriminator}.`);
            readiness.discord = true;
            updateReadiness();
            return;
        } catch (err) {
            lastError = err;
            readiness.discord = false;
            updateReadiness();
            console.error(`[discord] Availability check attempt ${attempt}/${totalAttempts} failed:`, err);
            if (attempt >= totalAttempts) break;
            const waitMs = Math.min(baseDelay * 2 ** (attempt - 1), 30_000);
            console.log(`[discord] Retrying bot availability check in ${waitMs}ms…`);
            await delay(waitMs);
        }
    }

    throw lastError ?? new Error('Discord bot did not become ready.');
}

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

function ensureMusicState(game) {
    const raw = game && typeof game.music === 'object' ? game.music : {};
    const trackId = typeof raw.trackId === 'string' ? raw.trackId.trim() : '';
    const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString();
    const valid = trackId && MUSIC_TRACK_IDS.has(trackId);
    const normalized = {
        trackId: valid ? trackId : '',
        updatedAt,
    };
    game.music = normalized;
    return normalized;
}

function presentMusicState(music) {
    if (!music || typeof music !== 'object') {
        return { trackId: '', updatedAt: null };
    }
    const trackId = typeof music.trackId === 'string' ? music.trackId : '';
    const updatedAt = typeof music.updatedAt === 'string' ? music.updatedAt : new Date().toISOString();
    if (!trackId || !MUSIC_TRACK_IDS.has(trackId)) {
        return { trackId: '', updatedAt };
    }
    return { trackId, updatedAt };
}

function sanitizeAlertMessage(value) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, MAX_ALERT_LENGTH);
}

function clamp01(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    if (num <= 0) return 0;
    if (num >= 1) return 1;
    return num;
}

function toBoolean(value, defaultValue = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (!normalized) return defaultValue;
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }
    if (value === null || value === undefined) return defaultValue;
    return Boolean(value);
}

function normalizeRotation(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    const normalized = num % 360;
    return normalized < 0 ? normalized + 360 : normalized;
}

function defaultMapBackground() {
    return {
        url: '',
        x: 0.5,
        y: 0.5,
        scale: DEFAULT_BACKGROUND_SCALE,
        rotation: 0,
        opacity: DEFAULT_BACKGROUND_OPACITY,
    };
}

function normalizeMapBackground(entry) {
    const defaults = defaultMapBackground();
    if (!entry || typeof entry !== 'object') {
        return { ...defaults };
    }
    const url = typeof entry.url === 'string' ? entry.url.trim() : '';
    const xSource = Object.prototype.hasOwnProperty.call(entry, 'x') ? entry.x : defaults.x;
    const ySource = Object.prototype.hasOwnProperty.call(entry, 'y') ? entry.y : defaults.y;
    const x = clamp01(xSource);
    const y = clamp01(ySource);
    const scaleRaw = Number(entry.scale);
    const scale = Number.isFinite(scaleRaw) ? Math.min(8, Math.max(0.2, scaleRaw)) : defaults.scale;
    const rotation = normalizeRotation(entry.rotation);
    const opacityRaw = Number(entry.opacity);
    const opacity = Number.isFinite(opacityRaw) ? Math.min(1, Math.max(0.05, opacityRaw)) : defaults.opacity;
    return { url, x, y, scale, rotation, opacity };
}

function presentMapBackground(background) {
    return normalizeMapBackground(background);
}

function normalizeMapShape(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const typeRaw = typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : 'rectangle';
    const type = MAP_SHAPE_TYPES.has(typeRaw) ? typeRaw : 'rectangle';
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : uuid();
    const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString();
    const updatedAt = typeof entry.updatedAt === 'string' ? entry.updatedAt : createdAt;
    const x = clamp01(Object.prototype.hasOwnProperty.call(entry, 'x') ? entry.x : 0.5);
    const y = clamp01(Object.prototype.hasOwnProperty.call(entry, 'y') ? entry.y : 0.5);
    const defaultSize = type === 'image' ? 0.4 : 0.25;
    const widthSource = Object.prototype.hasOwnProperty.call(entry, 'width') ? entry.width : defaultSize;
    const heightFallback = type === 'line' ? MIN_SHAPE_SIZE : defaultSize;
    const heightSource = Object.prototype.hasOwnProperty.call(entry, 'height') ? entry.height : heightFallback;
    let width = clamp01(widthSource);
    let height = clamp01(heightSource);
    if (!Number.isFinite(width) || width <= 0) width = defaultSize;
    if (!Number.isFinite(height) || height <= 0) height = type === 'line' ? MIN_SHAPE_SIZE : width;
    width = Math.max(MIN_SHAPE_SIZE, Math.min(1, width));
    height = Math.max(
        MIN_SHAPE_SIZE,
        Math.min(1, type === 'circle' || type === 'diamond' ? width : height),
    );
    const rotation = normalizeRotation(entry.rotation);
    const fillFallback = type === 'line' ? DEFAULT_SHAPE_STROKE : DEFAULT_SHAPE_FILL;
    const fill = type === 'image' ? 'transparent' : sanitizeColor(entry.fill, fillFallback);
    const stroke = sanitizeColor(entry.stroke, DEFAULT_SHAPE_STROKE);
    const strokeWidthRaw = Number(entry.strokeWidth);
    const strokeWidth = Number.isFinite(strokeWidthRaw)
        ? Math.min(20, Math.max(0, strokeWidthRaw))
        : DEFAULT_SHAPE_STROKE_WIDTH;
    const opacityRaw = Number(entry.opacity);
    const opacity = type === 'image'
        ? Math.min(1, Math.max(0.05, Number.isFinite(opacityRaw) ? opacityRaw : 1))
        : Number.isFinite(opacityRaw)
            ? Math.min(1, Math.max(0.05, opacityRaw))
            : DEFAULT_SHAPE_OPACITY;
    const url = type === 'image' && typeof entry.url === 'string' ? entry.url.trim() : '';
    return {
        id,
        type,
        x,
        y,
        width,
        height: type === 'circle' || type === 'diamond' ? width : height,
        rotation,
        fill,
        stroke,
        strokeWidth,
        opacity,
        ...(type === 'image' ? { url } : {}),
        createdAt,
        updatedAt,
    };
}

function presentMapShape(shape) {
    if (!shape || typeof shape !== 'object') return null;
    const normalized = normalizeMapShape(shape);
    if (!normalized) return null;
    return { ...normalized };
}

function findMapShape(map, shapeId) {
    if (!map || !Array.isArray(map.shapes)) return null;
    return map.shapes.find((shape) => shape && shape.id === shapeId) || null;
}

function applyMapShapeUpdate(shape, payload) {
    if (!shape || !payload || typeof payload !== 'object') return false;
    let changed = false;
    if (Object.prototype.hasOwnProperty.call(payload, 'x')) {
        const value = clamp01(payload.x);
        if (shape.x !== value) {
            shape.x = value;
            changed = true;
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'y')) {
        const value = clamp01(payload.y);
        if (shape.y !== value) {
            shape.y = value;
            changed = true;
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'width')) {
        const raw = clamp01(payload.width);
        const value = Math.max(MIN_SHAPE_SIZE, Math.min(1, raw));
        if (shape.width !== value) {
            shape.width = value;
            if (shape.type === 'circle' || shape.type === 'diamond') {
                shape.height = value;
            }
            changed = true;
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'height')) {
        const raw = clamp01(payload.height);
        const value = Math.max(MIN_SHAPE_SIZE, Math.min(1, raw));
        if (shape.type === 'circle' || shape.type === 'diamond') {
            if (shape.width !== value) {
                shape.width = value;
                shape.height = value;
                changed = true;
            }
        } else if (shape.height !== value) {
            shape.height = value;
            changed = true;
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'rotation')) {
        const value = normalizeRotation(payload.rotation);
        if (shape.rotation !== value) {
            shape.rotation = value;
            changed = true;
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'fill')) {
        const fallback = shape.type === 'line' ? shape.stroke : shape.fill || DEFAULT_SHAPE_FILL;
        const value = sanitizeColor(payload.fill, fallback);
        if (shape.fill !== value) {
            shape.fill = value;
            changed = true;
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'stroke')) {
        const value = sanitizeColor(payload.stroke, shape.stroke || DEFAULT_SHAPE_STROKE);
        if (shape.stroke !== value) {
            shape.stroke = value;
            changed = true;
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'strokeWidth')) {
        const raw = Number(payload.strokeWidth);
        const value = Number.isFinite(raw) ? Math.min(20, Math.max(0, raw)) : shape.strokeWidth;
        if (shape.strokeWidth !== value) {
            shape.strokeWidth = value;
            changed = true;
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'opacity')) {
        const raw = Number(payload.opacity);
        const value = Number.isFinite(raw) ? Math.min(1, Math.max(0.05, raw)) : shape.opacity;
        if (shape.opacity !== value) {
            shape.opacity = value;
            changed = true;
        }
    }
    if (shape.type === 'image' && Object.prototype.hasOwnProperty.call(payload, 'url')) {
        const nextUrl = typeof payload.url === 'string' ? payload.url.trim() : '';
        if (shape.url !== nextUrl) {
            shape.url = nextUrl;
            changed = true;
        }
    }
    return changed;
}

function applyBackgroundUpdate(map, payload) {
    if (!map || !payload || typeof payload !== 'object') return false;
    const target =
        map.background && typeof map.background === 'object'
            ? map.background
            : (map.background = defaultMapBackground());
    let changed = false;
    if (Object.prototype.hasOwnProperty.call(payload, 'url')) {
        const url = typeof payload.url === 'string' ? payload.url.trim() : '';
        if (target.url !== url) {
            target.url = url;
            changed = true;
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'x')) {
        const value = clamp01(payload.x);
        if (target.x !== value) {
            target.x = value;
            changed = true;
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'y')) {
        const value = clamp01(payload.y);
        if (target.y !== value) {
            target.y = value;
            changed = true;
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'scale')) {
        const raw = Number(payload.scale);
        const value = Number.isFinite(raw) ? Math.min(8, Math.max(0.2, raw)) : target.scale;
        if (target.scale !== value) {
            target.scale = value;
            changed = true;
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'rotation')) {
        const value = normalizeRotation(payload.rotation);
        if (target.rotation !== value) {
            target.rotation = value;
            changed = true;
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'opacity')) {
        const raw = Number(payload.opacity);
        const value = Number.isFinite(raw) ? Math.min(1, Math.max(0.05, raw)) : target.opacity;
        if (target.opacity !== value) {
            target.opacity = value;
            changed = true;
        }
    }
    return changed;
}

function clearMapBackground(map) {
    if (!map) return false;
    map.background = defaultMapBackground();
    map.background.url = '';
    return true;
}

function captureMapSnapshot(game) {
    const map = ensureMapState(game);
    return {
        strokes: map.strokes.map((stroke) => ({ ...stroke })),
        tokens: map.tokens.map((token) => ({ ...token })),
        shapes: map.shapes.map((shape) => ({ ...shape })),
        background: { ...(map.background || defaultMapBackground()) },
        settings: { ...(map.settings || {}) },
    };
}

function normalizeMapSnapshot(snapshot, game) {
    const tempGame = { ...game, map: snapshot };
    const map = ensureMapState(tempGame);
    return {
        strokes: map.strokes.map((stroke) => ({ ...stroke })),
        tokens: map.tokens.map((token) => ({ ...token })),
        shapes: map.shapes.map((shape) => ({ ...shape })),
        background: { ...(map.background || defaultMapBackground()) },
        settings: { ...(map.settings || {}) },
    };
}

function normalizeMapLibraryEntry(entry, game) {
    if (!entry || typeof entry !== 'object') return null;
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : uuid();
    const name = sanitizeText(entry.name).trim() || 'Saved Battle Map';
    const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString();
    const updatedAt = typeof entry.updatedAt === 'string' ? entry.updatedAt : createdAt;
    const snapshot = normalizeMapSnapshot(entry.snapshot || game?.map || {}, game);
    const previewUrl =
        typeof entry.previewUrl === 'string' && entry.previewUrl.trim()
            ? entry.previewUrl.trim()
            : snapshot.background?.url || '';
    return { id, name, createdAt, updatedAt, snapshot, previewUrl };
}

function ensureMapLibrary(game) {
    if (!game || typeof game !== 'object') return [];
    if (!Array.isArray(game.mapLibrary)) {
        game.mapLibrary = [];
        return game.mapLibrary;
    }
    game.mapLibrary = game.mapLibrary
        .map((entry) => normalizeMapLibraryEntry(entry, game))
        .filter(Boolean);
    if (game.mapLibrary.length > MAX_MAP_LIBRARY_ENTRIES) {
        game.mapLibrary = game.mapLibrary
            .sort((a, b) => {
                const aKey = a.createdAt || '';
                const bKey = b.createdAt || '';
                return aKey.localeCompare(bKey);
            })
            .slice(game.mapLibrary.length - MAX_MAP_LIBRARY_ENTRIES);
    }
    return game.mapLibrary;
}

function presentMapLibraryEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    return {
        id: entry.id,
        name: entry.name,
        createdAt: entry.createdAt || null,
        updatedAt: entry.updatedAt || entry.createdAt || null,
        previewUrl: entry.previewUrl || '',
    };
}

function presentMapLibrary(library) {
    if (!Array.isArray(library)) return [];
    return library
        .slice()
        .sort((a, b) => {
            const aKey = a.updatedAt || a.createdAt || '';
            const bKey = b.updatedAt || b.createdAt || '';
            return bKey.localeCompare(aKey);
        })
        .map((entry) => presentMapLibraryEntry(entry))
        .filter(Boolean);
}

function applyMapSnapshot(game, snapshot) {
    if (!game) return null;
    const current = ensureMapState(game);
    const normalized = normalizeMapSnapshot(snapshot, game);
    const timestamp = new Date().toISOString();
    game.map = {
        strokes: normalized.strokes,
        tokens: normalized.tokens,
        shapes: normalized.shapes,
        background: normalized.background,
        settings: { ...(normalized.settings || {}) },
        paused: current.paused,
        updatedAt: timestamp,
    };
    return game.map;
}

function sanitizeColor(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    return HEX_COLOR_REGEX.test(trimmed) ? trimmed.toLowerCase() : fallback;
}

function normalizeMapPoint(point) {
    if (!point) return null;
    let x;
    let y;
    if (Array.isArray(point)) {
        [x, y] = point;
    } else if (typeof point === 'object') {
        x = point.x;
        y = point.y;
    }
    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null;
    return { x: clamp01(x), y: clamp01(y) };
}

function normalizeMapStroke(entry, extras = {}) {
    if (!entry || typeof entry !== 'object') return null;
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : uuid();
    const widthRaw = Number(entry.size);
    const size = Number.isFinite(widthRaw) ? Math.min(32, Math.max(1, widthRaw)) : 3;
    const color = sanitizeColor(entry.color, DEFAULT_STROKE_COLOR);
    const points = [];
    const sourcePoints = Array.isArray(entry.points) ? entry.points : [];
    for (const point of sourcePoints) {
        const normalized = normalizeMapPoint(point);
        if (!normalized) continue;
        points.push(normalized);
        if (points.length >= MAX_MAP_POINTS_PER_STROKE) break;
    }
    if (points.length < 2) return null;
    const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString();
    const createdBy = typeof entry.createdBy === 'string' ? entry.createdBy : extras.createdBy || null;
    return { id, size, color, points, createdAt, createdBy };
}

function buildPlayerTooltip(player) {
    if (!player || typeof player !== 'object') return '';
    const lines = [];
    const character = player.character || {};
    if (character?.profile?.class) lines.push(character.profile.class);
    const levelRaw = Number(character?.resources?.level);
    if (Number.isFinite(levelRaw) && levelRaw > 0) lines.push(`Level ${levelRaw}`);
    const hpRaw = Number(character?.resources?.hp);
    const maxHpRaw = Number(character?.resources?.maxHP);
    if (Number.isFinite(hpRaw) && Number.isFinite(maxHpRaw)) {
        lines.push(`HP ${hpRaw}/${maxHpRaw}`);
    }
    return lines.join(' · ');
}

function buildDemonTooltip(demon) {
    if (!demon || typeof demon !== 'object') return '';
    const lines = [];
    if (demon.arcana) lines.push(demon.arcana);
    if (demon.alignment) lines.push(demon.alignment);
    const levelRaw = Number(demon.level);
    if (Number.isFinite(levelRaw) && levelRaw > 0) lines.push(`Level ${levelRaw}`);
    return lines.join(' · ');
}

function normalizeMapToken(entry, game) {
    if (!entry || typeof entry !== 'object') return null;
    const kindRaw = typeof entry.kind === 'string' ? entry.kind.trim().toLowerCase() : 'custom';
    const allowedKinds = new Set(['player', 'demon', 'enemy', 'custom']);
    const kind = allowedKinds.has(kindRaw) ? kindRaw : 'custom';
    let refId = typeof entry.refId === 'string' ? entry.refId : null;
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : uuid();
    let label = sanitizeText(entry.label).trim();
    let tooltip = sanitizeText(entry.tooltip).trim();
    const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString();
    const updatedAt = typeof entry.updatedAt === 'string' ? entry.updatedAt : createdAt;
    let showTooltip = entry.showTooltip === undefined ? true : !!entry.showTooltip;
    let color = sanitizeColor(entry.color, DEFAULT_CUSTOM_TOKEN_COLOR);
    let ownerId = typeof entry.ownerId === 'string' ? entry.ownerId : null;

    if (kind === 'player') {
        const player = findPlayer(game, refId);
        if (!player) return null;
        refId = player.userId;
        ownerId = player.userId;
        if (!label) {
            label = describePlayerLabel(player, { username: player.username });
        }
        if (!tooltip) tooltip = buildPlayerTooltip(player);
        color = sanitizeColor(entry.color, DEFAULT_PLAYER_TOKEN_COLOR);
    } else if (kind === 'demon') {
        const demon = Array.isArray(game.demons) ? game.demons.find((d) => d && d.id === refId) : null;
        if (!demon) return null;
        refId = demon.id;
        if (!label) label = demon.name || 'Demon';
        if (!tooltip) tooltip = buildDemonTooltip(demon);
        color = sanitizeColor(entry.color, DEFAULT_DEMON_TOKEN_COLOR);
    } else if (kind === 'enemy') {
        if (!label) label = 'Enemy';
        if (entry.showTooltip === undefined) showTooltip = !!tooltip;
        color = sanitizeColor(entry.color, DEFAULT_ENEMY_TOKEN_COLOR);
    } else {
        if (!label) label = 'Marker';
        if (entry.showTooltip === undefined) showTooltip = !!tooltip;
    }

    const x = clamp01(entry.x);
    const y = clamp01(entry.y);

    return { id, kind, refId, label, tooltip, showTooltip, color, x, y, createdAt, updatedAt, ownerId };
}

function presentMapStroke(stroke) {
    if (!stroke || typeof stroke !== 'object') return null;
    const points = Array.isArray(stroke.points)
        ? stroke.points
              .map((point) => normalizeMapPoint(point))
              .filter(Boolean)
        : [];
    if (points.length < 2) return null;
    return {
        id: stroke.id,
        size: Number(stroke.size) || 3,
        color: sanitizeColor(stroke.color, DEFAULT_STROKE_COLOR),
        points,
        createdAt: typeof stroke.createdAt === 'string' ? stroke.createdAt : null,
        createdBy: typeof stroke.createdBy === 'string' ? stroke.createdBy : null,
    };
}

function presentMapToken(token) {
    if (!token || typeof token !== 'object') return null;
    const fallbackColor =
        token.kind === 'player'
            ? DEFAULT_PLAYER_TOKEN_COLOR
            : token.kind === 'demon'
                ? DEFAULT_DEMON_TOKEN_COLOR
                : token.kind === 'enemy'
                    ? DEFAULT_ENEMY_TOKEN_COLOR
                    : DEFAULT_CUSTOM_TOKEN_COLOR;
    return {
        id: token.id,
        kind: token.kind,
        refId: token.refId || null,
        label: token.label || '',
        tooltip: token.tooltip || '',
        showTooltip: !!token.showTooltip,
        color: sanitizeColor(token.color, fallbackColor),
        x: clamp01(token.x),
        y: clamp01(token.y),
        ownerId: typeof token.ownerId === 'string' ? token.ownerId : null,
        updatedAt: typeof token.updatedAt === 'string' ? token.updatedAt : null,
        createdAt: typeof token.createdAt === 'string' ? token.createdAt : null,
    };
}

function ensureMapState(game) {
    if (!game || typeof game !== 'object') {
        return {
            strokes: [],
            tokens: [],
            shapes: [],
            settings: { allowPlayerDrawing: true, allowPlayerTokenMoves: true },
            paused: false,
            background: defaultMapBackground(),
            updatedAt: new Date().toISOString(),
        };
    }
    const raw = game.map && typeof game.map === 'object' ? game.map : {};
    const settingsRaw = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    let strokes = Array.isArray(raw.strokes)
        ? raw.strokes.map((stroke) => normalizeMapStroke(stroke)).filter(Boolean)
        : [];
    if (strokes.length > MAX_MAP_STROKES) {
        strokes = strokes.slice(-MAX_MAP_STROKES);
    }
    const tokens = Array.isArray(raw.tokens)
        ? raw.tokens.map((token) => normalizeMapToken(token, game)).filter(Boolean)
        : [];
    let shapes = Array.isArray(raw.shapes)
        ? raw.shapes.map((shape) => normalizeMapShape(shape)).filter(Boolean)
        : [];
    if (shapes.length > MAX_MAP_SHAPES) {
        shapes = shapes.slice(-MAX_MAP_SHAPES);
    }
    const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString();
    const mapState = {
        strokes,
        tokens,
        shapes,
        settings: {
            allowPlayerDrawing: toBoolean(settingsRaw.allowPlayerDrawing, true),
            allowPlayerTokenMoves: toBoolean(settingsRaw.allowPlayerTokenMoves, true),
        },
        paused: toBoolean(raw.paused, false),
        background: presentMapBackground(raw.background),
        updatedAt,
    };
    game.map = mapState;
    return mapState;
}

function presentMapState(map) {
    if (!map || typeof map !== 'object') {
        return {
            strokes: [],
            tokens: [],
            shapes: [],
            settings: { allowPlayerDrawing: true, allowPlayerTokenMoves: true },
            paused: false,
            background: defaultMapBackground(),
            updatedAt: null,
        };
    }
    const strokes = Array.isArray(map.strokes)
        ? map.strokes.map((stroke) => presentMapStroke(stroke)).filter(Boolean)
        : [];
    const tokens = Array.isArray(map.tokens)
        ? map.tokens.map((token) => presentMapToken(token)).filter(Boolean)
        : [];
    const shapes = Array.isArray(map.shapes)
        ? map.shapes.map((shape) => presentMapShape(shape)).filter(Boolean)
        : [];
    return {
        strokes,
        tokens,
        shapes,
        settings: {
            allowPlayerDrawing: toBoolean(map.settings?.allowPlayerDrawing, true),
            allowPlayerTokenMoves: toBoolean(map.settings?.allowPlayerTokenMoves, true),
        },
        paused: toBoolean(map.paused, false),
        background: presentMapBackground(map.background),
        updatedAt: typeof map.updatedAt === 'string' ? map.updatedAt : null,
    };
}

function canDrawOnMap(game, userId) {
    if (!userId) return false;
    if (isDM(game, userId)) return true;
    if (!isMember(game, userId)) return false;
    const map = ensureMapState(game);
    if (map.paused) return false;
    return !!map.settings?.allowPlayerDrawing;
}

function canMoveMapToken(game, userId, token) {
    if (!userId || !token) return false;
    if (isDM(game, userId)) return true;
    if (!isMember(game, userId)) return false;
    const map = ensureMapState(game);
    if (map.paused) return false;
    if (!map.settings?.allowPlayerTokenMoves) return false;
    return !!token.ownerId && token.ownerId === userId;
}

function findMapToken(map, tokenId) {
    if (!map || !Array.isArray(map.tokens)) return null;
    return map.tokens.find((token) => token && token.id === tokenId) || null;
}

/**
 * Read the bot token configured for Discord synchronization.
 * Falls back to legacy BOT_TOKEN if present.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
function getDiscordBotToken(env = process.env) {
    if (env && typeof env.DISCORD_BOT_TOKEN === 'string' && env.DISCORD_BOT_TOKEN.trim()) {
        return readBotToken(env.DISCORD_BOT_TOKEN);
    }
    if (env && typeof env.BOT_TOKEN === 'string' && env.BOT_TOKEN.trim()) {
        return readBotToken(env.BOT_TOKEN);
    }
    return DEFAULT_DISCORD_BOT_TOKEN || null;
}

const ITEMS_PATH = path.join(__dirname, 'data', 'premade-items.json');
const TXT_DOCS_PATH = path.join(SHARED_PATH, 'txtdocs');
const INDEX_CANDIDATES = [
    path.join(DIST_PATH, 'index.html'),
    path.join(PUBLIC_PATH, 'index.html'),
    path.join(PROJECT_ROOT, 'client', 'index.html'),
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
    if (typeof game.fuseSeed !== 'string' || !game.fuseSeed.trim()) {
        game.fuseSeed = crypto.randomBytes(16).toString('hex');
    }
    if (!game.permissions || typeof game.permissions !== 'object') {
        game.permissions = {
            canEditStats: false,
            canEditItems: false,
            canEditGear: false,
            canEditDemons: false,
            canEditCombatSkills: false,
        };
    } else {
        game.permissions = {
            canEditStats: !!game.permissions.canEditStats,
            canEditItems: !!game.permissions.canEditItems,
            canEditGear: !!game.permissions.canEditGear,
            canEditDemons: !!game.permissions.canEditDemons,
            canEditCombatSkills: !!game.permissions.canEditCombatSkills,
        };
    }
    if (!Array.isArray(game.invites)) game.invites = [];
    game.story = ensureStoryConfig(game);
    game.worldSkills = ensureWorldSkills(game);
    game.combatSkills = ensureCombatSkills(game);
    game.media = ensureMediaState(game);
    game.music = ensureMusicState(game);
    game.map = ensureMapState(game);
    game.mapLibrary = ensureMapLibrary(game);
    return game;
}

function presentGame(game, { includeSecrets = false } = {}) {
    const normalized = ensureGameShape(game);
    if (!normalized) return null;
    const story = ensureStoryConfig(normalized);
    const worldSkills = ensureWorldSkills(normalized);
    const combatSkills = ensureCombatSkills(normalized);
    const players = Array.isArray(normalized.players)
        ? normalized.players.map((player) => {
            if (!player || typeof player !== 'object') return player;
            const online = isUserOnlineInGame(normalized.id, player.userId);
            return { ...player, online };
        })
        : [];
    return {
        id: normalized.id,
        name: normalized.name,
        dmId: normalized.dmId,
        players,
        items: normalized.items,
        gear: normalized.gear,
        demons: normalized.demons,
        demonPool: normalized.demonPool,
        fuseSeed: normalized.fuseSeed,
        permissions: normalized.permissions,
        invites: normalized.invites,
        story: presentStoryConfig(story, { includeSecrets }),
        worldSkills,
        combatSkills,
        media: presentMediaState(normalized.media),
        music: presentMusicState(normalized.music),
        map: presentMapState(normalized.map),
        ...(includeSecrets ? { mapLibrary: presentMapLibrary(normalized.mapLibrary) } : {}),
    };
}

function presentLibraryItem(doc) {
    const raw = stripMongoMetadata(doc);
    if (!raw) return null;
    const {
        slug,
        name,
        type = '',
        desc = '',
        category = '',
        subcategory = '',
        slot = '',
        tags = [],
        order = 0,
        healing = null,
    } = raw;
    if (!slug || !name) return null;
    const normalizedHealing = healing && typeof healing === 'object' && Object.keys(healing).length > 0
        ? {
              ...(typeof healing.hp === 'number' ? { hp: healing.hp } : {}),
              ...(typeof healing.hpPercent === 'number' ? { hpPercent: healing.hpPercent } : {}),
              ...(typeof healing.mp === 'number' ? { mp: healing.mp } : {}),
              ...(typeof healing.mpPercent === 'number' ? { mpPercent: healing.mpPercent } : {}),
              ...(healing.revive ? { revive: healing.revive } : {}),
          }
        : null;
    return {
        id: slug,
        slug,
        name,
        type,
        desc,
        category,
        subcategory,
        slot,
        tags: Array.isArray(tags) ? tags : [],
        order,
        ...(normalizedHealing ? { healing: normalizedHealing } : {}),
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
    const { provided, value } = readLibraryItemId(item);
    if (provided) {
        normalized.libraryItemId = value;
    }
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

const COMBAT_TIER_ORDER = ['WEAK', 'MEDIUM', 'HEAVY', 'SEVERE'];
const COMBAT_CATEGORY_ALIASES = new Map([
    ['physical', 'physical'],
    ['phys', 'physical'],
    ['melee', 'physical'],
    ['gun', 'gun'],
    ['ranged', 'gun'],
    ['shoot', 'gun'],
    ['spell', 'spell'],
    ['magic', 'spell'],
    ['caster', 'spell'],
    ['support', 'support'],
    ['buff', 'support'],
    ['heal', 'support'],
    ['hybrid', 'hybrid'],
    ['other', 'hybrid'],
    ['tech', 'hybrid'],
]);
const COMBAT_CATEGORY_LIST = ['physical', 'gun', 'spell', 'support', 'hybrid'];

function normalizeCombatCategory(raw) {
    if (typeof raw !== 'string') return 'physical';
    const key = raw.trim().toLowerCase();
    if (!key) return 'physical';
    if (COMBAT_CATEGORY_ALIASES.has(key)) {
        return COMBAT_CATEGORY_ALIASES.get(key);
    }
    return COMBAT_CATEGORY_LIST.includes(key) ? key : 'hybrid';
}

function slugifyCombatSkillLabel(label) {
    const base = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return base || `combat-${uuid().slice(0, 8)}`;
}

function normalizeCombatSkillEntry(entry, seen) {
    if (!entry || typeof entry !== 'object') return null;
    const label = sanitizeText(entry.label ?? entry.name).trim();
    if (!label) return null;
    const abilityRaw = typeof entry.ability === 'string' ? entry.ability.trim().toUpperCase() : '';
    const ability = ABILITY_CODES.has(abilityRaw) ? abilityRaw : 'STR';
    const tierRaw = typeof entry.tier === 'string' ? entry.tier.trim().toUpperCase() : '';
    const tier = COMBAT_TIER_ORDER.includes(tierRaw) ? tierRaw : COMBAT_TIER_ORDER[0];
    const category = normalizeCombatCategory(entry.category ?? entry.type);
    const cost = sanitizeText(entry.cost ?? entry.resource ?? '').trim();
    const notes = sanitizeText(entry.notes ?? entry.description ?? '').trim();
    let id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : null;
    if (!id && typeof entry.key === 'string' && entry.key.trim()) id = entry.key.trim();
    if (!id) id = slugifyCombatSkillLabel(label);
    let unique = id;
    let attempt = 1;
    while (seen.has(unique)) {
        attempt += 1;
        unique = `${id}-${attempt}`;
    }
    seen.add(unique);
    return { id: unique, key: unique, label, ability, tier, category, cost, notes };
}

function ensureCombatSkills(game) {
    if (!game || typeof game !== 'object') return [];
    const source = Array.isArray(game.combatSkills) ? game.combatSkills : [];
    const seen = new Set();
    const normalized = [];
    for (const entry of source) {
        const skill = normalizeCombatSkillEntry(entry, seen);
        if (skill) normalized.push(skill);
    }
    game.combatSkills = normalized;
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
        primaryBot: {
            available: PRIMARY_DISCORD_INFO.available,
            inviteUrl: PRIMARY_DISCORD_INFO.inviteUrl,
            applicationId: PRIMARY_DISCORD_INFO.applicationId,
            defaultGuildId: PRIMARY_DISCORD_INFO.defaultGuildId,
            defaultChannelId: PRIMARY_DISCORD_INFO.defaultChannelId,
        },
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
    if (existing) {
        let channelLabel = 'unknown';
        try {
            const status = typeof existing.watcher?.getStatus === 'function'
                ? existing.watcher.getStatus()
                : null;
            channelLabel = status?.channel?.id || status?.channel?.name || channelLabel;
        } catch {
            channelLabel = 'unknown';
        }
        console.log(`[discord] Removing story watcher for game ${gameId} (channel ${channelLabel}).`);
    }
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
    storyWatcherSkipReasons.delete(gameId);
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
    const existing = storyWatchers.get(game.id);
    if (!token || !story.channelId) {
        const reason = !token ? 'missing bot token' : 'missing channel ID';
        const previousReason = storyWatcherSkipReasons.get(game.id);
        if (previousReason !== reason) {
            console.warn(`[discord] Skipping watcher for game ${game.id}: ${reason}.`);
            storyWatcherSkipReasons.set(game.id, reason);
        }
        removeStoryWatcher(game.id);
        return null;
    }
    storyWatcherSkipReasons.delete(game.id);

    const signature = `${token}:${story.channelId}:${story.guildId || ''}:${story.pollIntervalMs}`;
    if (existing && existing.signature === signature) {
        if (!existing.reuseLogged) {
            console.log(`[discord] Reusing story watcher for game ${game.id} (channel ${story.channelId}).`);
            existing.reuseLogged = true;
        }
        return existing.watcher;
    }

    removeStoryWatcher(game.id);
    console.log(
        `[discord] Creating story watcher for game ${game.id} (channel ${story.channelId}, poll ${story.pollIntervalMs}ms).`,
    );
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
        storyWatchers.set(game.id, { watcher, signature, unsubscribe, reuseLogged: false });
        return watcher;
    }
    console.warn(
        `[discord] Story watcher for game ${game.id} not enabled despite valid config; check watcher status.`,
    );
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

function getOrCreateMap(map, key) {
    let value = map.get(key);
    if (!value) {
        value = new Map();
        map.set(key, value);
    }
    return value;
}

function sendJson(ws, payload) {
    if (!ws || ws.readyState !== ws.OPEN) return;
    try {
        ws.send(JSON.stringify(payload));
    } catch (err) {
        console.warn('Failed to send websocket payload', err);
    }
}

function getOnlineUserIds(gameId) {
    if (!gameId) return [];
    const presence = gamePresence.get(gameId);
    if (!presence) return [];
    const online = [];
    for (const [userId, count] of presence) {
        if (count > 0) online.push(userId);
    }
    return online;
}

function isUserOnlineInGame(gameId, userId) {
    if (!gameId || !userId) return false;
    const presence = gamePresence.get(gameId);
    if (!presence) return false;
    return (presence.get(userId) || 0) > 0;
}

function broadcastPresenceUpdate(gameId, userId, online) {
    if (!gameId || !userId) return;
    const sockets = gameSubscribers.get(gameId);
    if (!sockets || sockets.size === 0) return;
    const payload = { type: 'presence:update', gameId, userId, online: !!online };
    for (const socket of sockets) {
        sendJson(socket, payload);
    }
}

function markUserOnlineForGame(gameId, userId) {
    if (!gameId || !userId) return;
    const presence = getOrCreateMap(gamePresence, gameId);
    const prev = presence.get(userId) || 0;
    const next = prev + 1;
    presence.set(userId, next);
    if (prev === 0) {
        broadcastPresenceUpdate(gameId, userId, true);
    }
}

function markUserOfflineForGame(gameId, userId) {
    if (!gameId || !userId) return;
    const presence = gamePresence.get(gameId);
    if (!presence) return;
    const prev = presence.get(userId) || 0;
    const next = prev - 1;
    if (next <= 0) {
        presence.delete(userId);
        broadcastPresenceUpdate(gameId, userId, false);
    } else {
        presence.set(userId, next);
    }
    if (presence.size === 0) {
        gamePresence.delete(gameId);
    }
}

function sendPresenceState(ws, gameId) {
    if (!ws || !gameId) return;
    const online = getOnlineUserIds(gameId);
    sendJson(ws, { type: 'presence:state', gameId, online });
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

function broadcastMusicState(game) {
    if (!game || !game.id) return;
    broadcastGameMessage(game.id, {
        type: 'music:state',
        gameId: game.id,
        music: presentMusicState(game.music),
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
    if (ws.userId) {
        markUserOnlineForGame(gameId, ws.userId);
    }
    sendPresenceState(ws, gameId);
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
    const hadSubscription = ws.gameSubscriptions.delete(gameId);
    if (!hadSubscription) return;
    const set = gameSubscribers.get(gameId);
    if (set) {
        set.delete(ws);
        if (set.size === 0) gameSubscribers.delete(gameId);
    }
    if (ws.userId) {
        markUserOfflineForGame(gameId, ws.userId);
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
            case 'music.play': {
                const gameId = parseUUID(message.gameId);
                const trackId = typeof message.trackId === 'string' ? message.trackId.trim() : '';
                if (!gameId || !trackId) {
                    sendJson(ws, {
                        type: 'music:error',
                        error: 'invalid_request',
                        gameId: gameId || null,
                    });
                    break;
                }
                if (!MUSIC_TRACK_IDS.has(trackId) || !getMusicTrack(trackId)) {
                    sendJson(ws, { type: 'music:error', error: 'invalid_track', gameId });
                    break;
                }
                const db = await readDB();
                const game = getGame(db, gameId);
                if (!game || !isMember(game, ws.userId)) {
                    sendJson(ws, { type: 'music:error', error: 'not_found', gameId });
                    break;
                }
                if (!isDM(game, ws.userId)) {
                    sendJson(ws, { type: 'music:error', error: 'forbidden', gameId });
                    break;
                }
                const music = ensureMusicState(game);
                music.trackId = trackId;
                music.updatedAt = new Date().toISOString();
                await persistGame(db, game, { broadcast: false });
                broadcastMusicState(game);
                break;
            }
            case 'music.stop': {
                const gameId = parseUUID(message.gameId);
                if (!gameId) break;
                const db = await readDB();
                const game = getGame(db, gameId);
                if (!game || !isMember(game, ws.userId)) {
                    sendJson(ws, { type: 'music:error', error: 'not_found', gameId: gameId || null });
                    break;
                }
                if (!isDM(game, ws.userId)) {
                    sendJson(ws, { type: 'music:error', error: 'forbidden', gameId });
                    break;
                }
                const music = ensureMusicState(game);
                music.trackId = '';
                music.updatedAt = new Date().toISOString();
                await persistGame(db, game, { broadcast: false });
                broadcastMusicState(game);
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

function normalizeLibraryItemId(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return '';
    return trimmed.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function readLibraryItemId(source) {
    if (!source || typeof source !== 'object') {
        return { provided: false, value: null };
    }
    const keys = ['libraryItemId', 'libraryId'];
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            const normalized = normalizeLibraryItemId(source[key]);
            return { provided: true, value: normalized || null };
        }
    }
    return { provided: false, value: null };
}

async function findLibraryItemById(libraryItemId) {
    const slug = normalizeLibraryItemId(libraryItemId);
    if (!slug) return null;
    return Item.findOne({ slug }).lean();
}

async function syncInventoryEntryWithLibrary(entry, libraryItemId, { overwrite = false } = {}) {
    if (!entry || typeof entry !== 'object') return null;
    const libraryItem = await findLibraryItemById(libraryItemId);
    if (!libraryItem) {
        if (Object.prototype.hasOwnProperty.call(entry, 'libraryItemId')) {
            entry.libraryItemId = null;
        }
        return null;
    }
    entry.libraryItemId = libraryItem.slug;
    if (overwrite || !entry.type) {
        entry.type = sanitizeText(libraryItem.type);
    }
    if (overwrite || !entry.desc) {
        entry.desc = sanitizeText(libraryItem.desc);
    }
    if (overwrite || !entry.name) {
        entry.name = sanitizeText(libraryItem.name);
    }
    return libraryItem;
}

function applyHealingEffect(resources, healing) {
    if (!resources || typeof resources !== 'object' || !healing || typeof healing !== 'object') {
        return { changed: false, revived: false, hpBefore: 0, hpAfter: 0, mpBefore: 0, mpAfter: 0 };
    }
    const hpBeforeRaw = Number(resources.hp);
    const mpBeforeRaw = Number(resources.mp);
    let hp = Number.isFinite(hpBeforeRaw) ? hpBeforeRaw : 0;
    let mp = Number.isFinite(mpBeforeRaw) ? mpBeforeRaw : 0;
    const maxHpRaw = Number(resources.maxHP);
    const maxMpRaw = Number(resources.maxMP);
    const maxHP = Number.isFinite(maxHpRaw) ? maxHpRaw : null;
    const maxMP = Number.isFinite(maxMpRaw) ? maxMpRaw : null;
    let changed = false;
    let revived = false;
    let usedPercentForRevive = false;
    let usedFlatForRevive = false;

    if (healing.revive) {
        if (hp <= 0) {
            if (typeof healing.hpPercent === 'number' && healing.hpPercent > 0 && maxHP && maxHP > 0) {
                hp = Math.min(maxHP, Math.max(1, Math.ceil((maxHP * healing.hpPercent) / 100)));
                usedPercentForRevive = true;
            } else if (typeof healing.hp === 'number' && healing.hp > 0) {
                hp = maxHP && maxHP > 0 ? Math.min(maxHP, Math.max(1, healing.hp)) : Math.max(1, healing.hp);
                usedFlatForRevive = true;
            } else if (healing.revive === 'full' && maxHP && maxHP > 0) {
                hp = maxHP;
            } else if (maxHP && maxHP > 0) {
                hp = Math.max(1, Math.ceil(maxHP * 0.25));
            } else {
                hp = 1;
            }
            revived = true;
            changed = true;
        } else if (healing.revive === 'full' && maxHP && maxHP > 0 && hp < maxHP) {
            hp = maxHP;
            changed = true;
        }
    }

    if (typeof healing.hpPercent === 'number' && healing.hpPercent > 0 && maxHP && maxHP > 0 && !usedPercentForRevive) {
        const amount = Math.max(0, Math.ceil((maxHP * healing.hpPercent) / 100));
        if (amount > 0) {
            const next = Math.min(maxHP, hp + amount);
            if (next !== hp) {
                hp = next;
                changed = true;
            }
        }
    }

    if (typeof healing.hp === 'number' && healing.hp > 0 && !usedFlatForRevive) {
        const cap = maxHP && maxHP > 0 ? maxHP : null;
        const next = cap ? Math.min(cap, hp + healing.hp) : hp + healing.hp;
        if (next !== hp) {
            hp = next;
            changed = true;
        }
    }

    if (typeof healing.mpPercent === 'number' && healing.mpPercent > 0 && maxMP && maxMP > 0) {
        const amount = Math.max(0, Math.ceil((maxMP * healing.mpPercent) / 100));
        if (amount > 0) {
            const next = Math.min(maxMP, mp + amount);
            if (next !== mp) {
                mp = next;
                changed = true;
            }
        }
    }

    if (typeof healing.mp === 'number' && healing.mp > 0) {
        const cap = maxMP && maxMP > 0 ? maxMP : null;
        const next = cap ? Math.min(cap, mp + healing.mp) : mp + healing.mp;
        if (next !== mp) {
            mp = next;
            changed = true;
        }
    }

    if (hp < 0) hp = 0;
    if (mp < 0) mp = 0;

    if (changed) {
        resources.hp = hp;
        if (resources.mp !== undefined || typeof healing.mp === 'number' || typeof healing.mpPercent === 'number') {
            resources.mp = mp;
        }
    }

    return {
        changed,
        revived,
        hpBefore: Number.isFinite(hpBeforeRaw) ? hpBeforeRaw : 0,
        hpAfter: hp,
        mpBefore: Number.isFinite(mpBeforeRaw) ? mpBeforeRaw : 0,
        mpAfter: mp,
    };
}

function readImageUrl(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 2048) return '';
    try {
        const url = new URL(trimmed);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return '';
        }
        return url.toString();
    } catch {
        return '';
    }
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
        : DEFAULT_DISCORD_POLL_INTERVAL_MS;
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

function stripMongoMetadata(doc) {
    if (!doc || typeof doc !== 'object') return doc;
    const { _id, __v, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = doc;
    return rest;
}

async function loadSeedDatabase() {
    if (!legacySeedPromise) {
        legacySeedPromise = (async () => {
            try {
                const raw = await fs.readFile(DEFAULT_DB_PATH, 'utf8');
                const parsed = JSON.parse(raw);
                return normalizeDB(parsed);
            } catch (err) {
                if (err && err.code === 'ENOENT') {
                    console.log(
                        `[db] No legacy seed database found at ${DEFAULT_DB_PATH}; skipping import.`,
                    );
                } else {
                    console.warn('Failed to read default database seed', err);
                }
                return null;
            }
        })();
    }

    return legacySeedPromise;
}

async function ensureInitialItemDocs() {
    try {
        const entries = await loadItemEntries({ file: ITEMS_PATH });
        if (!Array.isArray(entries) || entries.length === 0) {
            console.warn('[db] No premade items found; skipping library sync.');
            return 0;
        }
        const now = new Date();
        const bulkOps = entries.map((entry) => ({
            updateOne: {
                filter: { slug: entry.slug },
                update: {
                    $set: { ...entry, updatedAt: now },
                    $setOnInsert: { createdAt: now },
                },
                upsert: true,
            },
        }));
        if (bulkOps.length > 0) {
            await Item.bulkWrite(bulkOps, { ordered: false });
            const keepSlugs = entries.map((entry) => entry.slug);
            await Item.deleteMany({ slug: { $nin: keepSlugs } });
        }
        console.log(`[db] Synchronized ${entries.length} items into the library.`);
        return entries.length;
    } catch (err) {
        console.warn('[db] Failed to synchronize item library', err);
        return 0;
    }
}

async function ensureInitialDemonDocs() {
    try {
        const existing = await Demon.countDocuments({});
        if (existing > 0) {
            console.log(`[db] Demon codex already contains ${existing} entries.`);
            return existing;
        }

        const entries = await loadDemonEntries();
        if (entries.length === 0) {
            console.warn('[db] No demons found in data/demons.json; skipping codex seed.');
            return 0;
        }

        console.log('[db] Demon codex empty; seeding from data/demons.json…');

        const bulkOps = entries.map((entry) => ({
            replaceOne: {
                filter: { slug: entry.slug },
                replacement: entry,
                upsert: true,
            },
        }));

        await Demon.bulkWrite(bulkOps, { ordered: false });
        console.log(`[db] Seeded ${entries.length} demons into the codex.`);
        return entries.length;
    } catch (err) {
        console.warn('[db] Failed to seed demon codex', err);
        return 0;
    }
}

async function readDB() {
    const [users, games] = await Promise.all([
        User.find().lean(),
        Game.find().lean(),
    ]);

    const normalized = {
        users: users.map((doc) => stripMongoMetadata(doc)),
        games: games.map((doc) => stripMongoMetadata(doc)),
    };

    if (normalized.users.length === 0 && normalized.games.length === 0) {
        const seed = await loadSeedDatabase();
        if (seed && (seed.users.length > 0 || seed.games.length > 0)) {
            await writeDB(seed);
            return seed;
        }
    }

    return normalizeDB(normalized);
}

async function writeDB(db) {
    const normalized = normalizeDB(db);
    const userDocs = normalized.users.map((doc) => stripMongoMetadata(doc));
    const gameDocs = normalized.games.map((doc) => stripMongoMetadata(doc));

    if (userDocs.length > 0) {
        await User.bulkWrite(userDocs.map((user) => ({
            updateOne: { filter: { id: user.id }, update: { $set: user }, upsert: true },
        })));
        const ids = userDocs.map((user) => user.id);
        await User.deleteMany({ id: { $nin: ids } });
    } else {
        await User.deleteMany({});
    }

    if (gameDocs.length > 0) {
        await Game.bulkWrite(gameDocs.map((game) => ({
            replaceOne: { filter: { id: game.id }, replacement: game, upsert: true },
        })));
        const ids = gameDocs.map((game) => game.id);
        await Game.deleteMany({ id: { $nin: ids } });
    } else {
        await Game.deleteMany({});
    }
}

function hash(pw, salt) {
    return crypto.createHash('sha256').update(salt + pw).digest('hex');
}

const app = express();

const resolvedTrustProxy = (() => {
    if (TRUST_PROXY) {
        const numeric = Number(TRUST_PROXY);
        return Number.isNaN(numeric) ? TRUST_PROXY : numeric;
    }

    if (SESSION_COOKIE_SECURE) {
        console.log('[session] TRUST_PROXY not set; defaulting to 1 because SESSION_COOKIE_SECURE=true.');
        return 1;
    }

    return null;
})();

if (resolvedTrustProxy !== null && resolvedTrustProxy !== undefined) {
    app.set('trust proxy', resolvedTrustProxy);
}

app.use(cors({
    origin(origin, callback) {
        if (isOriginAllowed(origin)) {
            callback(null, true);
            return;
        }
        callback(null, false);
    },
    credentials: true,
}));

app.use(express.json());

// if you ever run behind a proxy/https later
// app.set('trust proxy', 1);

const sessionCookie = {
    sameSite: SESSION_COOKIE_SAME_SITE,
    secure: SESSION_COOKIE_SECURE,
};

if (SESSION_COOKIE_DOMAIN) {
    sessionCookie.domain = SESSION_COOKIE_DOMAIN;
}

const sessionStore = new MongoSessionStore({
    uri: MONGODB_URI,
    dbName: MONGODB_DB_NAME || undefined,
    collectionName: SESSION_COLLECTION,
    ttlSeconds: SESSION_TTL_SECONDS,
});

let sessionStoreClosed = false;
let sessionsCleared = false;
async function closeSessionStore() {
    if (sessionStoreClosed) return;
    sessionStoreClosed = true;
    try {
        await sessionStore.close();
        console.log('[session] Session store closed.');
    } catch (err) {
        console.warn('[session] Failed to close session store:', err);
    }
}

async function logoutAllUsers() {
    if (sessionsCleared) return;
    sessionsCleared = true;
    try {
        await sessionStore.clear();
        console.log('[session] Cleared all active sessions.');
    } catch (err) {
        console.warn('[session] Failed to clear active sessions during shutdown:', err);
    }
}

const sessionParser = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: sessionCookie,
});

app.use(sessionParser);

app.get('/health', (_req, res) => {
    const status = {
        ready: readiness.ready,
        components: {
            db: readiness.db,
            discord: readiness.discord,
            server: readiness.server,
        },
    };
    res.status(readiness.ready ? 200 : 503).json(status);
});

app.use((req, res, next) => {
    if (readiness.ready) return next();
    res.status(503).json({ error: 'server_initializing' });
});

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
        .map((g) => ({
            id: g.id,
            name: g.name,
            dmId: g.dmId,
            players: Array.isArray(g.players)
                ? g.players.map((p) => {
                    if (!p || typeof p !== 'object') return p;
                    const online = isUserOnlineInGame(g.id, p.userId);
                    return { ...p, online };
                })
                : [],
        }));
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
        fuseSeed: crypto.randomBytes(16).toString('hex'),
        permissions: {
            canEditStats: false,
            canEditItems: false,
            canEditGear: false,
            canEditDemons: false,
            canEditCombatSkills: false,
        },
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
        map: {
            strokes: [],
            tokens: [],
            shapes: [],
            settings: { allowPlayerDrawing: true, allowPlayerTokenMoves: true },
            paused: false,
            background: defaultMapBackground(),
            updatedAt: new Date().toISOString(),
        },
        mapLibrary: [],
    };
    ensureWorldSkills(game);
    ensureMapState(game);
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
        canEditCombatSkills: !!perms.canEditCombatSkills,
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

app.get('/api/games/:id/map', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }

    const map = ensureMapState(game);
    res.json(presentMapState(map));
});

app.put('/api/games/:id/map/settings', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const map = ensureMapState(game);
    const payload = req.body || {};
    let changed = false;

    if (Object.prototype.hasOwnProperty.call(payload, 'allowPlayerDrawing')) {
        const value = !!payload.allowPlayerDrawing;
        if (map.settings.allowPlayerDrawing !== value) {
            map.settings.allowPlayerDrawing = value;
            changed = true;
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'allowPlayerTokenMoves')) {
        const value = !!payload.allowPlayerTokenMoves;
        if (map.settings.allowPlayerTokenMoves !== value) {
            map.settings.allowPlayerTokenMoves = value;
            changed = true;
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'paused')) {
        const paused = !!payload.paused;
        if (map.paused !== paused) {
            map.paused = paused;
            changed = true;
        }
    }

    if (!changed) {
        return res.json(presentMapState(map));
    }

    map.updatedAt = new Date().toISOString();
    await persistGame(db, game, {
        reason: 'map:settings',
        actorId: req.session.userId,
        broadcast: true,
    });
    res.json(presentMapState(map));
});

app.post('/api/games/:id/map/strokes', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }

    const map = ensureMapState(game);
    if (!canDrawOnMap(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const payload = req.body?.stroke || req.body || {};
    const stroke = normalizeMapStroke(payload, { createdBy: req.session.userId });
    if (!stroke) {
        return res.status(400).json({ error: 'invalid_stroke' });
    }

    const timestamp = new Date().toISOString();
    stroke.createdAt = timestamp;
    stroke.createdBy = stroke.createdBy || req.session.userId;
    map.strokes.push(stroke);
    if (map.strokes.length > MAX_MAP_STROKES) {
        map.strokes = map.strokes.slice(-MAX_MAP_STROKES);
    }
    map.updatedAt = timestamp;

    await persistGame(db, game, {
        reason: 'map:stroke',
        actorId: req.session.userId,
        broadcast: !map.paused,
    });

    res.status(201).json(presentMapStroke(stroke));
});

app.delete('/api/games/:id/map/strokes/:strokeId', requireAuth, async (req, res) => {
    const { id, strokeId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const map = ensureMapState(game);
    const before = map.strokes.length;
    map.strokes = map.strokes.filter((stroke) => stroke && stroke.id !== strokeId);
    if (map.strokes.length === before) {
        return res.status(404).json({ error: 'stroke_not_found' });
    }

    map.updatedAt = new Date().toISOString();
    await persistGame(db, game, {
        reason: 'map:stroke:remove',
        actorId: req.session.userId,
        broadcast: !map.paused,
    });
    res.json({ ok: true });
});

app.post('/api/games/:id/map/strokes/clear', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const map = ensureMapState(game);
    map.strokes = [];
    map.updatedAt = new Date().toISOString();

    await persistGame(db, game, {
        reason: 'map:stroke:clear',
        actorId: req.session.userId,
        broadcast: !map.paused,
    });
    res.json({ ok: true });
});

app.post('/api/games/:id/map/shapes', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const map = ensureMapState(game);
    const payload = req.body?.shape || req.body || {};
    const shape = normalizeMapShape(payload);
    if (!shape) {
        return res.status(400).json({ error: 'invalid_shape' });
    }

    const timestamp = new Date().toISOString();
    shape.createdAt = timestamp;
    shape.updatedAt = timestamp;
    map.shapes.push(shape);
    if (map.shapes.length > MAX_MAP_SHAPES) {
        map.shapes = map.shapes.slice(-MAX_MAP_SHAPES);
    }
    map.updatedAt = timestamp;

    await persistGame(db, game, {
        reason: 'map:shape:add',
        actorId: req.session.userId,
        broadcast: !map.paused,
    });

    res.status(201).json(presentMapShape(shape));
});

app.put('/api/games/:id/map/shapes/:shapeId', requireAuth, async (req, res) => {
    const { id, shapeId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const map = ensureMapState(game);
    const shape = findMapShape(map, shapeId);
    if (!shape) {
        return res.status(404).json({ error: 'shape_not_found' });
    }

    const payload = req.body || {};
    const changed = applyMapShapeUpdate(shape, payload);
    if (!changed) {
        return res.json(presentMapShape(shape));
    }

    const timestamp = new Date().toISOString();
    shape.updatedAt = timestamp;
    map.updatedAt = timestamp;

    await persistGame(db, game, {
        reason: 'map:shape:update',
        actorId: req.session.userId,
        broadcast: !map.paused,
    });

    res.json(presentMapShape(shape));
});

app.delete('/api/games/:id/map/shapes/:shapeId', requireAuth, async (req, res) => {
    const { id, shapeId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const map = ensureMapState(game);
    const before = map.shapes.length;
    map.shapes = map.shapes.filter((shape) => shape && shape.id !== shapeId);
    if (before === map.shapes.length) {
        return res.status(404).json({ error: 'shape_not_found' });
    }

    map.updatedAt = new Date().toISOString();

    await persistGame(db, game, {
        reason: 'map:shape:remove',
        actorId: req.session.userId,
        broadcast: !map.paused,
    });

    res.json({ ok: true });
});

app.put('/api/games/:id/map/background', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const map = ensureMapState(game);
    const changed = applyBackgroundUpdate(map, req.body || {});
    if (!changed) {
        return res.json(presentMapBackground(map.background));
    }

    map.updatedAt = new Date().toISOString();

    await persistGame(db, game, {
        reason: 'map:background',
        actorId: req.session.userId,
        broadcast: !map.paused,
    });

    res.json(presentMapBackground(map.background));
});

app.delete('/api/games/:id/map/background', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const map = ensureMapState(game);
    const changed = clearMapBackground(map);
    if (!changed) {
        return res.json({ ok: true, background: presentMapBackground(map.background) });
    }
    map.updatedAt = new Date().toISOString();

    await persistGame(db, game, {
        reason: 'map:background:clear',
        actorId: req.session.userId,
        broadcast: !map.paused,
    });

    res.json({ ok: true, background: presentMapBackground(map.background) });
});

app.post('/api/games/:id/map/tokens', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const map = ensureMapState(game);
    const payload = req.body?.token || req.body || {};
    const base = {
        id: uuid(),
        kind: typeof payload.kind === 'string' ? payload.kind : 'custom',
        refId: typeof payload.refId === 'string' ? payload.refId : null,
        label: payload.label,
        tooltip: payload.tooltip,
        color: payload.color,
        showTooltip: payload.showTooltip,
        x: Object.prototype.hasOwnProperty.call(payload, 'x') ? payload.x : 0.5,
        y: Object.prototype.hasOwnProperty.call(payload, 'y') ? payload.y : 0.5,
    };
    const token = normalizeMapToken(base, game);
    if (!token) {
        return res.status(400).json({ error: 'invalid_token' });
    }
    const timestamp = new Date().toISOString();
    token.createdAt = timestamp;
    token.updatedAt = timestamp;

    map.tokens.push(token);
    map.updatedAt = timestamp;

    await persistGame(db, game, {
        reason: 'map:token:add',
        actorId: req.session.userId,
        broadcast: !map.paused,
    });

    res.status(201).json(presentMapToken(token));
});

app.put('/api/games/:id/map/tokens/:tokenId', requireAuth, async (req, res) => {
    const { id, tokenId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }

    const map = ensureMapState(game);
    const token = findMapToken(map, tokenId);
    if (!token) {
        return res.status(404).json({ error: 'token_not_found' });
    }

    const payload = req.body || {};
    const isDMUser = isDM(game, req.session.userId);
    let changed = false;

    if (Object.prototype.hasOwnProperty.call(payload, 'x') || Object.prototype.hasOwnProperty.call(payload, 'y')) {
        if (!canMoveMapToken(game, req.session.userId, token)) {
            return res.status(403).json({ error: 'forbidden' });
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'x')) {
            token.x = clamp01(payload.x);
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'y')) {
            token.y = clamp01(payload.y);
        }
        changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'showTooltip')) {
        if (!isDMUser) {
            return res.status(403).json({ error: 'forbidden' });
        }
        token.showTooltip = !!payload.showTooltip;
        changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'label')) {
        if (!isDMUser) {
            return res.status(403).json({ error: 'forbidden' });
        }
        token.label = sanitizeText(payload.label).trim() || token.label;
        changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'tooltip')) {
        if (!isDMUser) {
            return res.status(403).json({ error: 'forbidden' });
        }
        token.tooltip = sanitizeText(payload.tooltip).trim();
        changed = true;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'color')) {
        if (!isDMUser) {
            return res.status(403).json({ error: 'forbidden' });
        }
        token.color = sanitizeColor(payload.color, token.color);
        changed = true;
    }

    if (!changed) {
        return res.json(presentMapToken(token));
    }

    const timestamp = new Date().toISOString();
    token.updatedAt = timestamp;
    map.updatedAt = timestamp;

    await persistGame(db, game, {
        reason: 'map:token:update',
        actorId: req.session.userId,
        broadcast: !map.paused,
    });

    res.json(presentMapToken(token));
});

app.delete('/api/games/:id/map/tokens/:tokenId', requireAuth, async (req, res) => {
    const { id, tokenId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const map = ensureMapState(game);
    const before = map.tokens.length;
    map.tokens = map.tokens.filter((token) => token && token.id !== tokenId);
    if (before === map.tokens.length) {
        return res.status(404).json({ error: 'token_not_found' });
    }

    map.updatedAt = new Date().toISOString();
    await persistGame(db, game, {
        reason: 'map:token:remove',
        actorId: req.session.userId,
        broadcast: !map.paused,
    });
    res.json({ ok: true });
});

app.get('/api/games/:id/map/library', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const library = ensureMapLibrary(game);
    res.json({ maps: presentMapLibrary(library) });
});

app.post('/api/games/:id/map/library', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const library = ensureMapLibrary(game);
    const nameInput = sanitizeText(req.body?.name).trim();
    const entryName = nameInput || `Battle Map ${library.length + 1}`;
    const timestamp = new Date().toISOString();
    const snapshot = captureMapSnapshot(game);
    const entry = {
        id: uuid(),
        name: entryName.slice(0, 80),
        createdAt: timestamp,
        updatedAt: timestamp,
        snapshot,
        previewUrl: snapshot.background?.url || '',
    };
    library.push(entry);
    ensureMapLibrary(game);

    await persistGame(db, game, { broadcast: false });

    res.status(201).json({ entry: presentMapLibraryEntry(entry), maps: presentMapLibrary(game.mapLibrary) });
});

app.delete('/api/games/:id/map/library/:entryId', requireAuth, async (req, res) => {
    const { id, entryId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const library = ensureMapLibrary(game);
    const before = library.length;
    game.mapLibrary = library.filter((entry) => entry && entry.id !== entryId);
    if (before === game.mapLibrary.length) {
        return res.status(404).json({ error: 'map_not_found' });
    }

    await persistGame(db, game, { broadcast: false });

    res.json({ maps: presentMapLibrary(game.mapLibrary) });
});

app.post('/api/games/:id/map/library/:entryId/load', requireAuth, async (req, res) => {
    const { id, entryId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!isDM(game, req.session.userId)) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const library = ensureMapLibrary(game);
    const entry = library.find((item) => item && item.id === entryId);
    if (!entry) {
        return res.status(404).json({ error: 'map_not_found' });
    }

    const map = applyMapSnapshot(game, entry.snapshot);
    entry.updatedAt = new Date().toISOString();

    await persistGame(db, game, {
        reason: 'map:library:load',
        actorId: req.session.userId,
        broadcast: true,
    });

    res.json({ map: presentMapState(map), entry: presentMapLibraryEntry(entry), maps: presentMapLibrary(game.mapLibrary) });
});

// --- World skills ---
app.post('/api/games/:id/combat-skills', requireAuth, async (req, res) => {
    const { id } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    const manager = isDM(game, req.session.userId);
    if (!manager && !game.permissions.canEditCombatSkills) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const list = ensureCombatSkills(game);
    const payload = req.body?.skill || req.body || {};
    const seen = new Set(list.map((skill) => skill.id));
    const entry = normalizeCombatSkillEntry(payload, seen);
    if (!entry) {
        return res.status(400).json({ error: 'invalid_skill' });
    }

    list.push(entry);
    await persistGame(db, game, { reason: 'combatSkill:add', actorId: req.session.userId });
    res.json(entry);
});

app.put('/api/games/:id/combat-skills/:skillId', requireAuth, async (req, res) => {
    const { id, skillId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    const manager = isDM(game, req.session.userId);
    if (!manager && !game.permissions.canEditCombatSkills) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const list = ensureCombatSkills(game);
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

    if (Object.prototype.hasOwnProperty.call(payload, 'tier')) {
        const tierRaw = typeof payload.tier === 'string' ? payload.tier.trim().toUpperCase() : '';
        if (!COMBAT_TIER_ORDER.includes(tierRaw)) {
            return res.status(400).json({ error: 'invalid_tier' });
        }
        if (tierRaw !== target.tier) {
            target.tier = tierRaw;
            changed = true;
        }
    }

    const hasCategoryField =
        Object.prototype.hasOwnProperty.call(payload, 'category') ||
        Object.prototype.hasOwnProperty.call(payload, 'type');
    if (hasCategoryField) {
        const nextCategory = normalizeCombatCategory(payload.category ?? payload.type ?? target.category);
        if (nextCategory !== target.category) {
            target.category = nextCategory;
            changed = true;
        }
    }

    if (
        Object.prototype.hasOwnProperty.call(payload, 'cost') ||
        Object.prototype.hasOwnProperty.call(payload, 'resource')
    ) {
        const nextCost = sanitizeText(payload.cost ?? payload.resource ?? '').trim();
        if (nextCost !== (target.cost || '')) {
            target.cost = nextCost;
            changed = true;
        }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'notes')) {
        const nextNotes = sanitizeText(payload.notes).trim();
        if (nextNotes !== (target.notes || '')) {
            target.notes = nextNotes;
            changed = true;
        }
    }

    if (!changed) {
        return res.status(400).json({ error: 'no_changes' });
    }

    await persistGame(db, game, { reason: 'combatSkill:update', actorId: req.session.userId });
    res.json(target);
});

app.delete('/api/games/:id/combat-skills/:skillId', requireAuth, async (req, res) => {
    const { id, skillId } = req.params || {};
    const db = await readDB();
    const game = getGame(db, id);
    if (!game || !isMember(game, req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }
    const manager = isDM(game, req.session.userId);
    if (!manager && !game.permissions.canEditCombatSkills) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const list = ensureCombatSkills(game);
    const next = list.filter((skill) => skill && skill.id !== skillId);
    if (next.length === list.length) {
        return res.status(404).json({ error: 'skill_not_found' });
    }
    game.combatSkills = next;

    await persistGame(db, game, { reason: 'combatSkill:delete', actorId: req.session.userId });
    res.json({ ok: true });
});

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
    const payload = {
        name: sanitizeText(item?.name),
        type: sanitizeText(item?.type),
        desc: sanitizeText(item?.desc),
    };
    const { provided, value } = readLibraryItemId(item);
    if (provided) {
        payload.libraryItemId = value;
    }
    return payload;
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
    const { provided: libraryProvided, value: libraryId } = readLibraryItemId(payload);

    const entry = {
        id: uuid(),
        name,
        type,
        desc,
        amount,
    };

    if (libraryProvided) {
        if (libraryId) {
            await syncInventoryEntryWithLibrary(entry, libraryId);
        } else {
            entry.libraryItemId = null;
        }
    }

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
    const { provided: updateLibrary, value: nextLibraryId } = readLibraryItemId(payload);
    if (updateLibrary) {
        if (nextLibraryId) {
            await syncInventoryEntryWithLibrary(entry, nextLibraryId);
        } else {
            entry.libraryItemId = null;
        }
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

app.post('/api/games/:id/players/:playerId/items/:itemId/use', requireAuth, async (req, res) => {
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

    const actorId = req.session.userId;
    const isActorDM = isDM(game, actorId);
    if (!isActorDM && actorId !== playerId) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const list = ensureInventoryList(target);
    const entry = list.find((it) => it && it.id === itemId);
    if (!entry) return res.status(404).json({ error: 'item_not_found' });

    const currentAmount = normalizeCount(entry.amount, 1);
    if (currentAmount <= 0) {
        return res.status(400).json({ error: 'item_depleted' });
    }

    const character = target.character && typeof target.character === 'object' ? target.character : null;
    if (!character) {
        return res.status(400).json({ error: 'no_character' });
    }
    character.resources = character.resources && typeof character.resources === 'object' ? character.resources : {};

    let healing = null;
    if (entry.libraryItemId) {
        const libraryItem = await findLibraryItemById(entry.libraryItemId);
        if (libraryItem?.healing) {
            healing = libraryItem.healing;
        }
    }
    if (!healing) {
        const parsed = parseHealingEffect(entry.desc);
        if (parsed) healing = parsed;
    }
    if (!healing) {
        return res.status(400).json({ error: 'item_not_usable' });
    }

    const result = applyHealingEffect(character.resources, healing);
    if (!result.changed) {
        return res.status(400).json({ error: 'no_effect' });
    }

    const remaining = Math.max(0, currentAmount - 1);
    if (remaining <= 0) {
        target.inventory = list.filter((it) => it && it.id !== itemId);
    } else {
        entry.amount = remaining;
    }

    await persistGame(db, game, { reason: 'inventory:use', actorId: actorId });
    res.json({
        ok: true,
        itemId,
        remaining,
        applied: result,
    });
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

const RESISTANCE_ALIAS_MAP = {
    weak: ['weak', 'weaks'],
    resist: ['resist', 'resists'],
    block: ['block', 'blocks', 'null', 'nullify', 'nullifies'],
    drain: ['drain', 'drains', 'absorb', 'absorbs'],
    reflect: ['reflect', 'reflects'],
};

function readResistanceValues(source, key) {
    if (!source || typeof source !== 'object') return null;
    const aliases = RESISTANCE_ALIAS_MAP[key] || [key];
    const values = new Set();
    let found = false;
    for (const alias of aliases) {
        if (!Object.prototype.hasOwnProperty.call(source, alias)) continue;
        const raw = source[alias];
        if (raw === undefined) continue;
        found = true;
        for (const entry of normalizeArray(raw)) {
            values.add(entry);
        }
    }
    return found ? Array.from(values) : null;
}

function resolveResistanceField(sources, key) {
    const list = Array.isArray(sources) ? sources : [sources];
    for (const source of list) {
        const values = readResistanceValues(source, key);
        if (values !== null) return values;
    }
    return [];
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
    const resistanceInput = body.resistances || {};
    const demon = {
        id: uuid(),
        name: sanitizeText(body.name),
        arcana: sanitizeText(body.arcana),
        alignment: sanitizeText(body.alignment),
        level: Number(body.level) || 0,
        stats,
        mods: deriveAbilityMods(stats),
        resistances: {
            weak: resolveResistanceField(resistanceInput, 'weak'),
            resist: resolveResistanceField(resistanceInput, 'resist'),
            block: resolveResistanceField(resistanceInput, 'block'),
            drain: resolveResistanceField(resistanceInput, 'drain'),
            reflect: resolveResistanceField(resistanceInput, 'reflect'),
        },
        skills: normalizeArray(body.skills),
        notes: sanitizeText(body.notes || ''),
        image: readImageUrl(body.image),
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

    const resistanceUpdate = body.resistances || {};
    const resolveUpdate = (key) => {
        const override = readResistanceValues(resistanceUpdate, key);
        if (override !== null) return override;
        return resolveResistanceField([current.resistances, current], key);
    };

    const updated = {
        ...current,
        name: sanitizeText(body.name ?? current.name),
        arcana: sanitizeText(body.arcana ?? current.arcana),
        alignment: sanitizeText(body.alignment ?? current.alignment),
        level: Number(body.level ?? current.level) || 0,
        stats,
        mods: deriveAbilityMods(stats),
        resistances: {
            weak: resolveUpdate('weak'),
            resist: resolveUpdate('resist'),
            block: resolveUpdate('block'),
            drain: resolveUpdate('drain'),
            reflect: resolveUpdate('reflect'),
        },
        skills: body.skills !== undefined ? normalizeArray(body.skills) : (current.skills || []),
        notes: sanitizeText(body.notes ?? current.notes ?? ''),
        image: Object.prototype.hasOwnProperty.call(body, 'image') ? readImageUrl(body.image) : (current.image || ''),
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
        const docs = await Item.find().sort({ order: 1, name: 1 }).lean();
        const items = docs.map((doc) => presentLibraryItem(doc)).filter(Boolean);
        res.json(items);
    } catch (err) {
        console.warn('[api] Failed to load premade items', err);
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
app.use(express.static(PUBLIC_PATH));
app.use(express.static(DIST_PATH));

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
server.on('close', () => {
    readiness.server = false;
    updateReadiness();
    closeSessionStore().catch(() => {});
});
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

    if (!readiness.ready) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
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

function stopAllStoryWatchers() {
    for (const gameId of Array.from(storyWatchers.keys())) {
        removeStoryWatcher(gameId);
    }
}

function clearStoryBroadcastQueue() {
    for (const timer of storyBroadcastQueue.values()) {
        clearTimeout(timer);
    }
    storyBroadcastQueue.clear();
}

function clearPersonaRequests() {
    for (const request of pendingPersonaRequests.values()) {
        if (request?.timeout) {
            clearTimeout(request.timeout);
        }
    }
    pendingPersonaRequests.clear();
}

function clearPendingTrades() {
    for (const trade of pendingTrades.values()) {
        if (trade?.timeout) {
            clearTimeout(trade.timeout);
        }
    }
    pendingTrades.clear();
}

async function closeWebSocketServer({ timeoutMs = 2000 } = {}) {
    try {
        clearInterval(heartbeat);
    } catch {
        // ignore interval cleanup errors
    }

    for (const ws of wss.clients) {
        try {
            ws.close(1001, 'Server shutting down');
        } catch {
            // ignore close errors
        }
    }

    await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
        };

        try {
            wss.close(() => finish());
        } catch (err) {
            console.warn('[shutdown] Failed to close WebSocket server cleanly:', err);
            finish();
            return;
        }

        if (wss.clients.size === 0) {
            queueMicrotask(finish);
        } else if (timeoutMs > 0) {
            setTimeout(() => {
                for (const ws of wss.clients) {
                    try {
                        ws.terminate();
                    } catch {
                        // ignore terminate errors
                    }
                }
                finish();
            }, timeoutMs);
        }
    });
}

let shutdownPromise = null;

async function shutdownServer({ signal = null, exitCode = 0 } = {}) {
    if (shutdownPromise) return shutdownPromise;

    const label = signal ? `signal ${signal}` : 'request';
    console.log(`[shutdown] Initiating graceful shutdown (${label}).`);

    shutdownPromise = (async () => {
        readiness.server = false;
        updateReadiness();

        clearStoryBroadcastQueue();
        clearPersonaRequests();
        clearPendingTrades();
        stopAllStoryWatchers();

        await logoutAllUsers();

        try {
            await closeWebSocketServer();
        } catch (err) {
            console.warn('[shutdown] WebSocket shutdown encountered an error:', err);
        }

        if (server.listening) {
            await new Promise((resolve) => {
                server.close((err) => {
                    if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') {
                        console.warn('[shutdown] HTTP server close error:', err);
                    }
                    resolve();
                });
            });
        }

        await closeSessionStore();

        try {
            if (mongoose.connection.readyState !== 0) {
                await mongoose.disconnect();
                console.log('[db] MongoDB connection closed.');
            }
        } catch (err) {
            console.warn('[shutdown] Failed to disconnect MongoDB cleanly:', err);
        }

        storySubscribers.clear();
        gameSubscribers.clear();
        userSockets.clear();
        gamePresence.clear();

        console.log('[shutdown] Graceful shutdown complete.');
        return exitCode;
    })();

    return shutdownPromise;
}

let shutdownHooksInstalled = false;
let shutdownInitiated = false;

function setupGracefulShutdown() {
    if (shutdownHooksInstalled) return;
    shutdownHooksInstalled = true;

    const handleSignal = (signal) => {
        if (shutdownInitiated) {
            console.warn(`[shutdown] Received ${signal} during shutdown; forcing exit.`);
            process.exit(1);
            return;
        }
        shutdownInitiated = true;
        console.log(`[shutdown] Received ${signal}; starting graceful shutdown.`);
        shutdownServer({ signal, exitCode: 0 })
            .then((code) => {
                process.exit(code);
            })
            .catch((err) => {
                console.error('[shutdown] Error during graceful shutdown:', err);
                process.exit(1);
            });
    };

    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, () => handleSignal(signal));
    }

    process.on('uncaughtException', (err) => {
        console.error('[shutdown] Uncaught exception:', err);
        if (shutdownInitiated) {
            process.exit(1);
            return;
        }
        shutdownInitiated = true;
        shutdownServer({ exitCode: 1 })
            .then(() => process.exit(1))
            .catch(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason) => {
        console.error('[shutdown] Unhandled rejection:', reason);
    });
}

async function startServer() {
    console.log('[startup] Starting server bootstrap…');
    console.log('[startup] Connecting to MongoDB…');
    await connectToDatabaseWithRetry(MONGODB_URI, { dbName: MONGODB_DB_NAME || undefined });
    console.log('[startup] MongoDB connection established.');

    console.log('[startup] Loading initial data…');
    await ensureInitialItemDocs();
    await ensureInitialDemonDocs();
    console.log('[startup] Initial data ready.');

    console.log('[startup] Checking Discord bot availability…');
    await ensureDiscordBotOnline();

    const port = process.env.PORT || 3000;
    console.log('[startup] Starting HTTP server…');
    await new Promise((resolve, reject) => {
        const onError = (err) => {
            server.off('error', onError);
            reject(err);
        };
        server.once('error', onError);
        server.listen(port, () => {
            server.off('error', onError);
            readiness.server = true;
            updateReadiness();
            console.log(`[startup] HTTP server listening on ${port}.`);
            resolve();
        });
    });

    return port;
}
import imageProxy from './routes/image-proxy.routes.js';
app.use('/api/personas', imageProxy);

setupGracefulShutdown();

try {
    const port = await startServer();
    console.log(`[startup] Boot sequence finished on port ${port}.`);
} catch (err) {
    console.error('[startup] Failed to initialize server:', err);
    await shutdownServer({ exitCode: 1 }).catch(() => {});
    process.exit(1);
}
