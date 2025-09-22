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
const IMAGE_PROXY_TIMEOUT_MS = 10_000;
const DEMON_IMAGE_ALLOWED_HOSTS = new Set([
    'megatenwiki.com',
    'www.megatenwiki.com',
    'static.megatenwiki.com',
    'megatenwiki.miraheze.org',
    'static.miraheze.org',
    'static.wikia.nocookie.net',
]);
const DEMON_IMAGE_ALLOWED_SUFFIXES = ['megatenwiki.com', 'miraheze.org', 'nocookie.net'];

function normalizeImageUrl(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw || /^data:/i.test(raw) || /^blob:/i.test(raw)) {
        return null;
    }
    try {
        const parsed = new URL(raw, 'https://megatenwiki.com/');
        if (!/^https?:$/i.test(parsed.protocol)) return null;
        return parsed;
    } catch {
        return null;
    }
}

function resolveAllowedImageUrl(value) {
    const parsed = normalizeImageUrl(value);
    if (!parsed) return null;
    const host = (parsed.host || '').toLowerCase();
    if (!host) return null;
    if (DEMON_IMAGE_ALLOWED_HOSTS.has(host)) {
        return parsed;
    }
    const isAllowedSuffix = DEMON_IMAGE_ALLOWED_SUFFIXES.some(
        (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
    return isAllowedSuffix ? parsed : null;
}

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

// GET /api/personas/image-proxy?src=https%3A%2F%2Fexample.com
r.get('/image-proxy', async (req, res) => {
    const parsed = resolveAllowedImageUrl(req.query.src);
    if (!parsed) {
        return res.status(400).json({ error: 'unsupported image host' });
    }

    const targetUrl = parsed.toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_PROXY_TIMEOUT_MS);
    try {
        const response = await fetch(targetUrl, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'jack-endex/image-proxy (+https://jack-endex.app)',
                Referer: 'https://megatenwiki.com/wiki/Main_Page',
                Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            },
        });
        clearTimeout(timeout);

        if (!response.ok) {
            const status = response.status || 502;
            return res.status(status).json({ error: 'image fetch failed' });
        }

        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.type(contentType);
        }
        const cacheControl = response.headers.get('cache-control');
        if (cacheControl) {
            res.set('Cache-Control', cacheControl);
        } else {
            res.set('Cache-Control', 'public, max-age=86400');
        }
        const etag = response.headers.get('etag');
        if (etag) {
            res.set('ETag', etag);
        }
        const lastModified = response.headers.get('last-modified');
        if (lastModified) {
            res.set('Last-Modified', lastModified);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        res.send(buffer);
    } catch (error) {
        clearTimeout(timeout);
        if (error?.name === 'AbortError') {
            return res.status(504).json({ error: 'image fetch timeout' });
        }
        console.error('persona image proxy failed', error);
        res.status(502).json({ error: 'image proxy failed' });
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
