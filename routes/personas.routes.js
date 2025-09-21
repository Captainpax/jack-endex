// --- FILE: routes/personas.routes.js ---
import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Local persona data sourced from data/demons.json
const r = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMON_PATH = path.join(__dirname, '..', 'data', 'demons.json');
const SEARCH_QUERY_REGEX = /^[\p{L}\p{N}\s'-]+$/u;
const SLUG_REGEX = /^[a-z0-9-]+$/i;

function safeTrim(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

let cache = null;
async function loadDemons() {
    if (!cache) {
        const txt = await fs.readFile(DEMON_PATH, 'utf8');
        cache = JSON.parse(txt);
    }
    return cache;
}

function parseSearchQuery(value) {
    const raw = safeTrim(value);
    if (!raw) {
        return { isEmpty: true };
    }
    if (raw.length > 64) {
        return { error: 'invalid query length' };
    }
    if (!SEARCH_QUERY_REGEX.test(raw)) {
        return { error: 'invalid query format' };
    }
    return { value: raw.toLowerCase() };
}

function normalizeSlug(value) {
    const raw = safeTrim(value);
    if (!raw || raw.length > 64) {
        return null;
    }
    if (!SLUG_REGEX.test(raw)) {
        return null;
    }
    return raw.toLowerCase();
}

// GET /api/personas/search?q=jack
r.get('/search', async (req, res) => {
    try {
        const parsed = parseSearchQuery(req.query.q);
        if (parsed?.isEmpty) return res.json([]);
        if (parsed?.error) {
            return res.status(400).json({ error: parsed.error });
        }
        const q = parsed.value;
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
        const slug = normalizeSlug(req.params.slug);
        if (!slug) {
            return res.status(400).json({ error: 'invalid persona identifier' });
        }
        const demons = await loadDemons();
        const demon = demons.find(d => String(d.query ?? '').toLowerCase() === slug);
        if (!demon) return res.status(404).json({ error: 'persona not found' });
        res.json(demon);
    } catch (e) {
        console.error('persona lookup failed', e);
        res.status(500).json({ error: 'lookup failed' });
    }
});

export default r;
