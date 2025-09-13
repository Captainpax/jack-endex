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

// --- helpers ---
function normalizeDB(raw) {
    const db = raw && typeof raw === 'object' ? raw : {};
    return {
        users: Array.isArray(db.users) ? db.users : [],
        games: Array.isArray(db.games) ? db.games : [],
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
        players: [{ userId: req.session.userId, role: 'dm', character: null }],
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
    const g = (db.games || []).find(g => g && g.id === id);
    if (!g || !Array.isArray(g.players) || !g.players.some(p => p.userId === req.session.userId)) {
        return res.status(404).json({ error: 'not_found' });
    }

    const out = {
        id: g.id,
        name: g.name,
        dmId: g.dmId,
        players: Array.isArray(g.players) ? g.players : [],
        items: g.items && typeof g.items === 'object' ? g.items : { custom: [] },
        gear: g.gear && typeof g.gear === 'object' ? g.gear : { custom: [] },
        demons: Array.isArray(g.demons) ? g.demons : [],
        demonPool: g.demonPool && typeof g.demonPool === 'object' ? g.demonPool : { max: 0, used: 0 },
        permissions: g.permissions && typeof g.permissions === 'object'
            ? g.permissions
            : { canEditStats: false, canEditItems: false, canEditGear: false, canEditDemons: false },
        invites: Array.isArray(g.invites) ? g.invites : [],
    };

    res.json(out);
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
app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'server_error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`server listening on ${PORT}`));
