// --- FILE: routes/personas.routes.js ---
import { Router } from 'express';

// Proxy + thin utilities for Persona Compendium API
// Base: https://persona-compendium.onrender.com
// Endpoints used:
//  - GET /                         -> list of persona endpoint paths
//  - GET /personas/:slug/          -> single persona detail

const r = Router();
const BASE = 'https://persona-compendium.onrender.com';

// Cache the persona endpoint list so we don't hit the upstream on every search
let cachedList = null;
let cacheTime = 0;
const LIST_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchList() {
    if (cachedList && Date.now() - cacheTime < LIST_TTL) return cachedList;
    const root = await fetch(BASE + '/', { signal: AbortSignal.timeout(8000) });
    if (!root.ok) throw new Error('upstream error');
    const data = await root.json();
    cachedList = data["Persona Compendium API is live! Here's a list of all possible endpoints: /personas/"] || [];
    cacheTime = Date.now();
    return cachedList;
}

// GET /api/personas/search?q=jack
r.get('/search', async (req, res) => {
    try {
        const q = String(req.query.q || '').trim().toLowerCase();
        if (!q) return res.json([]);
        const norm = q.replace(/\s+/g, '-');
        const list = await fetchList();
        // list looks like ["/personas/jack-frost/", ...]
        const hits = list
            .map((p) => String(p))
            .filter((p) => p.startsWith('/personas/') && p.endsWith('/'))
            .map((p) => p.replace('/personas/', '').replace('/', ''))
            .filter((slug) => slug.includes(norm))
            .slice(0, 25)
            .map((slug) => ({
                slug,
                name: slug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')
            }));
        res.json(hits);
    } catch (e) {
        console.error('persona search failed', e);
        const msg = e.name === 'AbortError' ? 'search timeout' : 'search failed';
        res.status(500).json({ error: msg });
    }
});

// GET /api/personas/:slug
r.get('/:slug', async (req, res) => {
    try {
        const slug = req.params.slug;
        const r2 = await fetch(`${BASE}/personas/${encodeURIComponent(slug)}/`, {
            signal: AbortSignal.timeout(8000),
        });
        if (!r2.ok) return res.status(r2.status).json({ error: 'persona not found' });
        const json = await r2.json();
        res.json(json);
    } catch (e) {
        console.error('persona lookup failed', e);
        const msg = e.name === 'AbortError' ? 'lookup timeout' : 'lookup failed';
        res.status(500).json({ error: msg });
    }
});

export default r;
