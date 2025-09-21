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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const ITEMS_PATH = path.join(__dirname, 'data', 'premade-items.json');

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

function ensureGearSlots(player) {
    const raw = player && typeof player.gear === 'object' ? player.gear : {};
    const normalized = {};
    for (const slot of GEAR_SLOTS) {
        normalized[slot] = ensureGearEntry(raw?.[slot]) ?? null;
    }
    return normalized;
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
    out.gear = ensureGearSlots(out);
    return out;
}

function getGame(db, id) {
    const game = (db.games || []).find((g) => g && g.id === id);
    return ensureGameShape(game);
}

function saveGame(db, updated) {
    const idx = (db.games || []).findIndex((g) => g && g.id === updated.id);
    if (idx === -1) return;
    db.games[idx] = updated;
}

function isMember(game, userId) {
    return Array.isArray(game.players) && game.players.some((p) => p && p.userId === userId);
}

function isDM(game, userId) {
    return game.dmId === userId;
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

function canEditInventory(game, actingUserId, targetUserId) {
    if (isDM(game, actingUserId)) return true;
    if (actingUserId !== targetUserId) return false;
    return !!game.permissions?.canEditItems;
}

function ensureGearMap(player) {
    if (!player || typeof player !== 'object') return { weapon: null, armor: null, accessory: null };
    player.gear = ensureGearSlots(player);
    return player.gear;
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
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'missing fields' });

    const db = await readDB();
    if (db.users.some(u => u.username === username)) return res.status(400).json({ error: 'user exists' });

    const salt = crypto.randomBytes(8).toString('hex');
    const user = { id: uuid(), username, pass: `${salt}$${hash(password, salt)}` };
    db.users.push(user);
    await writeDB(db);

    req.session.userId = user.id;
    res.json({ id: user.id, username: user.username });
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body || {};
    const db = await readDB();
    const user = db.users.find(u => u.username === username);
    if (!user) return res.status(400).json({ error: 'invalid credentials' });

    const [salt, stored] = user.pass.split('$');
    if (hash(password, salt) !== stored) return res.status(400).json({ error: 'invalid credentials' });

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
        .map(g => ({ id: g.id, name: g.name, players: g.players || [] }));
    res.json(games);
});

app.post('/api/games', requireAuth, async (req, res) => {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'missing name' });

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
            gear: { weapon: null, armor: null, accessory: null },
        }],
        items: { custom: [] },
        gear: { custom: [] },
        demons: [],
        demonPool: { max: 0, used: 0 },
        permissions: { canEditStats: false, canEditItems: false, canEditGear: false, canEditDemons: false },
        invites: [],
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
    const { code } = req.params || {};
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
            gear: { weapon: null, armor: null, accessory: null },
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

app.put('/api/games/:id/players/:playerId/gear/:slot', requireAuth, async (req, res) => {
    const { id, playerId } = req.params || {};
    const slot = (req.params?.slot || '').toLowerCase();
    if (!GEAR_SLOTS.includes(slot)) {
        return res.status(400).json({ error: 'invalid_slot' });
    }

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

    const gear = ensureGearMap(target);
    const current = gear?.[slot];
    const entry = {
        id: typeof payload.id === 'string' && payload.id ? payload.id : current?.id || uuid(),
        name,
        type,
        desc,
    };

    gear[slot] = entry;
    saveGame(db, game);
    await writeDB(db);
    res.json(entry);
});

app.delete('/api/games/:id/players/:playerId/gear/:slot', requireAuth, async (req, res) => {
    const { id, playerId } = req.params || {};
    const slot = (req.params?.slot || '').toLowerCase();
    if (!GEAR_SLOTS.includes(slot)) {
        return res.status(400).json({ error: 'invalid_slot' });
    }

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

    const gear = ensureGearMap(target);
    if (!gear?.[slot]) {
        return res.status(404).json({ error: 'gear_not_found' });
    }

    gear[slot] = null;
    saveGame(db, game);
    await writeDB(db);
    res.json({ ok: true });
});

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
    if (!isDM(game, req.session.userId) && !game.permissions.canEditDemons) {
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
    if (!isDM(game, req.session.userId) && !game.permissions.canEditDemons) {
        return res.status(403).json({ error: 'forbidden' });
    }

    const next = game.demons.filter((d) => d && d.id !== demonId);
    game.demons = next;
    saveGame(db, game);
    await writeDB(db);
    res.json({ ok: true });
});

// (the rest of your routes unchanged, but add the same style of defensive checks on g.players, etc.)

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
