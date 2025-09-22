// --- FILE: routes/personas.routes.js ---
import { Router } from 'express';
import {
    searchDemons,
    findDemonBySlug,
    findClosestDemon,
    summarizeDemon,
} from '../services/demons.js';

const r = Router();
const SEARCH_QUERY_REGEX = /^[\p{L}\p{N}\s'-]+$/u;
const MAX_LOOKUP_LENGTH = 64;

function safeTrim(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function parseSearchQuery(value) {
    const raw = safeTrim(value);
    if (!raw) {
        return { isEmpty: true };
    }
    if (raw.length > MAX_LOOKUP_LENGTH) {
        return { error: 'invalid query length' };
    }
    if (!SEARCH_QUERY_REGEX.test(raw)) {
        return { error: 'invalid query format' };
    }
    return { value: raw };
}

function normalizeLookupTerm(value) {
    const raw = safeTrim(value);
    if (!raw || raw.length > MAX_LOOKUP_LENGTH) {
        return null;
    }
    return raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || null;
}

function buildSearchResult(demon) {
    if (!demon) return null;
    return {
        slug: demon.slug,
        query: demon.slug,
        name: demon.name,
        arcana: demon.arcana || '',
        alignment: demon.alignment || '',
        level: demon.level ?? null,
        image: demon.image || '',
    };
}

// GET /api/personas/search?q=jack
r.get('/search', async (req, res) => {
    try {
        const parsed = parseSearchQuery(req.query.q);
        if (parsed?.isEmpty) return res.json([]);
        if (parsed?.error) {
            return res.status(400).json({ error: parsed.error });
        }
        const hits = await searchDemons(parsed.value, { limit: 25 });
        res.json(hits.map((hit) => buildSearchResult(hit)).filter(Boolean));
    } catch (e) {
        console.error('persona search failed', e);
        res.status(500).json({ error: 'search failed' });
    }
});

// GET /api/personas/:slug
r.get('/:slug', async (req, res) => {
    try {
        const rawInput = safeTrim(req.params.slug);
        if (!rawInput) {
            return res.status(400).json({ error: 'invalid persona identifier' });
        }
        const normalized = normalizeLookupTerm(rawInput);
        let demon = null;
        if (normalized) {
            demon = await findDemonBySlug(normalized);
        }
        if (!demon) {
            const [firstHit] = await searchDemons(rawInput, { limit: 1 });
            if (firstHit) {
                demon = firstHit;
            }
        }
        if (!demon) {
            const suggestion = await findClosestDemon(rawInput);
            return res.status(404).json({
                error: 'persona_not_found',
                closeMatch: suggestion
                    ? {
                          slug: suggestion.slug,
                          name: suggestion.name,
                          distance: suggestion.distance,
                          confidence: Number((1 - suggestion.ratio).toFixed(3)),
                      }
                    : null,
            });
        }
        res.json(summarizeDemon(demon));
    } catch (e) {
        console.error('persona lookup failed', e);
        res.status(500).json({ error: 'lookup failed' });
    }
});

export default r;
