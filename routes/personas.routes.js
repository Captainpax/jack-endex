// --- FILE: routes/personas.routes.js ---
import { Router } from 'express';

// Proxy + thin utilities for Persona Compendium API
// Base: https://persona-compendium.onrender.com
// Endpoints used:
//  - GET /                         -> list of persona endpoint paths
//  - GET /personas/:slug/          -> single persona detail

const r = Router();
const BASE = 'https://persona-compendium.onrender.com';

// GET /api/personas/search?q=jack
r.get('/search', async (req, res) => {
    try {
        const q = String(req.query.q || '').trim().toLowerCase();
        if (!q) return res.json([]);
        const root = await fetch(BASE + '/');
        if (!root.ok) return res.status(502).json({ error: 'upstream error' });
        const data = await root.json();
        const list = data["Persona Compendium API is live! Here's a list of all possible endpoints: /personas/"] || [];
        // list looks like ["/personas/jack-frost/", ...]
        const hits = list
            .map((p) => String(p))
            .filter((p) => p.startsWith('/personas/') && p.endsWith('/'))
            .map((p) => p.replace('/personas/', '').replace('/', ''))
            .filter((slug) => slug.includes(q))
            .slice(0, 25)
            .map((slug) => ({
                slug,
                name: slug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')
            }));
        res.json(hits);
    } catch {
        res.status(500).json({ error: 'search failed' });
    }
});

// GET /api/personas/:slug
r.get('/:slug', async (req, res) => {
    try {
        const slug = req.params.slug;
        const r2 = await fetch(`${BASE}/personas/${encodeURIComponent(slug)}/`);
        if (!r2.ok) return res.status(r2.status).json({ error: 'persona not found' });
        const json = await r2.json();
        res.json(json);
    } catch {
        res.status(500).json({ error: 'lookup failed' });
    }
});

export default r;
