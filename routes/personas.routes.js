// --- FILE: routes/personas.routes.js ---
import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Local persona data sourced from data/demons.json
const r = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMON_PATH = path.join(__dirname, '..', 'data', 'demons.json');

let cache = null;
async function loadDemons() {
    if (!cache) {
        const txt = await fs.readFile(DEMON_PATH, 'utf8');
        cache = JSON.parse(txt);
    }
    return cache;
}

// GET /api/personas/search?q=jack
r.get('/search', async (req, res) => {
    try {
        const q = String(req.query.q || '').trim().toLowerCase();
        if (!q) return res.json([]);
        const demons = await loadDemons();
        const hits = demons
            .filter(d =>
                d.name.toLowerCase().includes(q) ||
                String(d.query || '').toLowerCase().includes(q)
            )
            .slice(0, 25)
            .map(d => ({ slug: d.query, name: d.name }));
        res.json(hits);
    } catch (e) {
        console.error('persona search failed', e);
        res.status(500).json({ error: 'search failed' });
    }
});

// GET /api/personas/:slug
r.get('/:slug', async (req, res) => {
    try {
        const demons = await loadDemons();
        const demon = demons.find(d => String(d.query) === req.params.slug);
        if (!demon) return res.status(404).json({ error: 'persona not found' });
        res.json(demon);
    } catch (e) {
        console.error('persona lookup failed', e);
        res.status(500).json({ error: 'lookup failed' });
    }
});

export default r;
