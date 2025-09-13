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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const ITEMS_PATH = path.join(__dirname, 'data', 'premade-items.json');

async function readDB() {
  try {
    return JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
  } catch {
    return { users: [], games: [] };
  }
}

async function writeDB(db) {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

function hash(pw, salt) {
  return crypto.createHash('sha256').update(salt + pw).digest('hex');
}

const app = express();
app.use(express.json());
app.use(session({ secret: 'dev-secret', resave: false, saveUninitialized: false }));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'unauthenticated' });
  next();
}

// --- Auth ---
app.get('/api/auth/me', async (req, res) => {
  const db = await readDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.json(null);
  res.json({ id: user.id, username: user.username });
});

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
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
  const { username, password } = req.body;
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
  const games = db.games.filter(g => g.players.some(p => p.userId === req.session.userId))
    .map(g => ({ id: g.id, name: g.name, players: g.players }));
  res.json(games);
});

app.post('/api/games', requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'missing name' });
  const db = await readDB();
  const game = {
    id: uuid(),
    name,
    dmId: req.session.userId,
    players: [{ userId: req.session.userId, role: 'dm', character: null }],
    items: { custom: [] },
    demons: [],
    demonPool: { max: 0, used: 0 },
    permissions: { canEditStats: false },
    invites: []
  };
  db.games.push(game);
  await writeDB(db);
  res.json(game);
});

app.get('/api/games/:id', requireAuth, async (req, res) => {
  const db = await readDB();
  const game = db.games.find(g => g.id === req.params.id && g.players.some(p => p.userId === req.session.userId));
  if (!game) return res.status(404).json({ error: 'not found' });
  res.json(game);
});

app.post('/api/games/:id/invites', requireAuth, async (req, res) => {
  const db = await readDB();
  const game = db.games.find(g => g.id === req.params.id);
  if (!game || game.dmId !== req.session.userId) return res.status(403).json({ error: 'forbidden' });
  const code = uuid().slice(0, 8);
  game.invites.push(code);
  await writeDB(db);
  res.json({ code, joinUrl: `/api/games/join/${code}` });
});

app.post('/api/games/join/:code', requireAuth, async (req, res) => {
  const db = await readDB();
  const game = db.games.find(g => g.invites.includes(req.params.code));
  if (!game) return res.status(404).json({ error: 'invalid code' });
  if (!game.players.some(p => p.userId === req.session.userId)) {
    game.players.push({ userId: req.session.userId, role: 'player', character: null });
    game.demonPool.max = (game.players.length - 1) * 2;
  }
  game.invites = game.invites.filter(c => c !== req.params.code);
  await writeDB(db);
  res.json({ ok: true });
});

app.put('/api/games/:id/permissions', requireAuth, async (req, res) => {
  const db = await readDB();
  const game = db.games.find(g => g.id === req.params.id);
  if (!game || game.dmId !== req.session.userId) return res.status(403).json({ error: 'forbidden' });
  game.permissions = { ...game.permissions, ...req.body };
  await writeDB(db);
  res.json({ ok: true });
});

app.put('/api/games/:id/character', requireAuth, async (req, res) => {
  const db = await readDB();
  const game = db.games.find(g => g.id === req.params.id && g.players.some(p => p.userId === req.session.userId));
  if (!game) return res.status(404).json({ error: 'not found' });
  const slot = game.players.find(p => p.userId === req.session.userId);
  if (slot.role !== 'dm' && !game.permissions.canEditStats) return res.status(403).json({ error: 'forbidden' });
  slot.character = req.body.character;
  await writeDB(db);
  res.json({ ok: true });
});

app.post('/api/games/:id/items/custom', requireAuth, async (req, res) => {
  const db = await readDB();
  const game = db.games.find(g => g.id === req.params.id);
  if (!game || game.dmId !== req.session.userId) return res.status(403).json({ error: 'forbidden' });
  const item = { id: uuid(), ...(req.body.item || {}) };
  game.items.custom.push(item);
  await writeDB(db);
  res.json(item);
});

app.post('/api/games/:id/demons', requireAuth, async (req, res) => {
  const db = await readDB();
  const game = db.games.find(g => g.id === req.params.id);
  if (!game || game.dmId !== req.session.userId) return res.status(403).json({ error: 'forbidden' });
  if (game.demons.length >= game.demonPool.max) return res.status(400).json({ error: 'demon pool full' });
  const demon = { id: uuid(), ...req.body };
  game.demons.push(demon);
  game.demonPool.used = game.demons.length;
  await writeDB(db);
  res.json(demon);
});

app.delete('/api/games/:id/demons/:demonId', requireAuth, async (req, res) => {
  const db = await readDB();
  const game = db.games.find(g => g.id === req.params.id);
  if (!game || game.dmId !== req.session.userId) return res.status(403).json({ error: 'forbidden' });
  game.demons = game.demons.filter(d => d.id !== req.params.demonId);
  game.demonPool.used = game.demons.length;
  await writeDB(db);
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

// Persona proxy routes
app.use('/api/personas', personas);

// Static files (if built)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'dist')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`server listening on ${PORT}`));
