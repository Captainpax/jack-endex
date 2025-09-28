// --- FILE: client/src/api.js ---
/**
 * AntiMatter Zone • Web API Utilities
 * - Safe JSON parsing (falls back to text/blob)
 * - Normalized ApiError with status/code/details
 * - Timeout via AbortController
 * - Optional retries with exponential backoff for idempotent requests (GET/HEAD)
 * - Credentials included by default (cookie-based auth), optional Bearer hook
 * - Query builder, pagination helper
 * - Tiny in-memory cache (opt-in per request)
 */

/** @typedef {{ status:number, code?:string, message:string, details?:any, url?:string }} ApiErrorShape */

export class ApiError extends Error {
    /** @type {number} */ status;
    /** @type {string|undefined} */ code;
    /** @type {any} */ details;
    /** @type {string|undefined} */ url;

    /**
     * @param {ApiErrorShape} shape
     */
    constructor(shape) {
        super(shape.message || 'API Error');
        this.name = 'ApiError';
        this.status = shape.status;
        this.code = shape.code;
        this.details = shape.details;
        this.url = shape.url;
    }
}

/** Simple TTL cache */
const _cache = new Map();
// Track active API requests for UI effects
const _activityListeners = new Set();
let _activeCount = 0;

export function onApiActivity(fn) {
    _activityListeners.add(fn);
    fn(_activeCount > 0);
    return () => _activityListeners.delete(fn);
}

function notifyActivity() {
    const active = _activeCount > 0;
    for (const fn of _activityListeners) fn(active);
}
/**
 * @param {string} key
 * @param {any} value
 * @param {number} ttlMs
 */
function cacheSet(key, value, ttlMs) {
    const expires = Date.now() + ttlMs;
    _cache.set(key, { value, expires });
}
/**
 * @param {string} key
 */
function cacheGet(key) {
    const hit = _cache.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expires) {
        _cache.delete(key);
        return undefined;
    }
    return hit.value;
}

/** Exponential backoff with jitter */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function backoff(attempt, base = 200, max = 2000) {
    const ms = Math.min(max, base * 2 ** attempt);
    // full jitter
    return Math.floor(Math.random() * ms);
}

/**
 * Safely parse a Response:
 * - If content-type JSON -> json()
 * - else text
 * - if binary (e.g., application/octet-stream, image/*) -> blob
 */
async function parseBody(res) {
    if (res.status === 204) return null;
    const type = res.headers.get('content-type') || '';
    try {
        if (type.includes('application/json')) return await res.json();
        if (type.startsWith('text/')) return await res.text();
        // Fallback for files/blobs
        return await res.blob();
    } catch {
        // As a last resort, try text then blob
        try { return await res.text(); } catch { return await res.blob(); }
    }
}

/**
 * Build query string from an object; skips null/undefined; arrays -> repeated keys.
 * @param {Record<string, any>} [q]
 */
function buildQuery(q) {
    if (!q) return '';
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) {
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) {
            for (const item of v) sp.append(k, String(item));
        } else {
            sp.append(k, String(v));
        }
    }
    const s = sp.toString();
    return s ? `?${s}` : '';
}

/**
 * @typedef {Object} CreateApiOptions
 * @property {string} [baseURL] - e.g., '/api'
 * @property {number} [timeoutMs] - default 12_000
 * @property {(init: RequestInit) => string | undefined} [getBearer] - return token to add as Authorization: Bearer <token>
 * @property {(err: ApiError) => void} [onUnauthorized] - invoked on 401
 */

/**
 * Create a configured API client.
 * Credentials are included by default for cookie-based auth.
 */
function resolveUrl(baseURL, path) {
    const normalizedPath = typeof path === 'string' ? path : '';
    const base = (typeof baseURL === 'string' ? baseURL : '').trim();

    if (!base) {
        return normalizedPath;
    }

    if (!normalizedPath) {
        return base;
    }

    if (/^(?:[a-z]+:)?\/\//i.test(normalizedPath)) {
        return normalizedPath;
    }

    if (/^(?:[a-z]+:)?\/\//i.test(base)) {
        try {
            return new URL(normalizedPath, base).toString();
        } catch {
            const baseTrimmed = base.replace(/\/+$|^\/+/g, '');
            const pathTrimmed = normalizedPath.replace(/^\/+/g, '');
            const joiner = baseTrimmed.endsWith('/') ? '' : '/';
            return `${baseTrimmed}${joiner}${pathTrimmed}`;
        }
    }

    const fakeOrigin = 'http://__jack_endex_internal__';
    try {
        const baseUrl = new URL(base.startsWith('/') ? base : `/${base}`, fakeOrigin);
        const resolved = new URL(normalizedPath, baseUrl);
        return resolved.pathname + resolved.search + resolved.hash;
    } catch {
        const basePrefix = base.startsWith('/') ? base : `/${base}`;
        const cleanedBase = basePrefix.replace(/\/+$|^\/+/g, '/');
        const cleanedPath = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
        return `${cleanedBase.replace(/\/$/, '')}${cleanedPath}`;
    }
}

function appendQueryString(url, queryString) {
    if (!queryString) return url;
    if (queryString.startsWith('?')) {
        if (url.includes('?')) {
            const separator = url.endsWith('?') || url.endsWith('&') ? '' : '&';
            return `${url}${separator}${queryString.slice(1)}`;
        }
        return `${url}${queryString}`;
    }
    return `${url}${url.includes('?') ? '&' : '?'}${queryString}`;
}

export function createApi({
                              baseURL = '',
                              timeoutMs = 12_000,
                              getBearer,
                              onUnauthorized,
                          } = /** @type {CreateApiOptions} */ ({})) {

    /**
     * @typedef {Object} RequestOptions
     * @property {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'|'HEAD'} [method]
     * @property {Record<string,string>} [headers]
     * @property {any} [body] - if object, auto-JSON unless FormData/Blob/ArrayBuffer provided
     * @property {Record<string, any>} [query]
     * @property {AbortSignal} [signal]
     * @property {boolean} [noRetry] - disable retry/backoff
     * @property {number} [retries] - override default retry attempts
     * @property {number} [timeoutMs]
     * @property {boolean|number} [cache] - false to skip (default), number = TTL ms for GET caching
     * @property {'json'|'text'|'blob'|'auto'} [expect] - hint the parser (defaults to auto)
     * @property {RequestCredentials} [credentials] - defaults to 'include'
     */

    /**
     * Core request
     * @param {string} path
     * @param {RequestOptions} [opts]
     */
    async function request(path, opts = {}) {
        const { quiet = false, ...rest } = opts || {};
        if (!quiet) {
            _activeCount++;
            notifyActivity();
        }
        try {
            const {
                method = 'GET',
                headers = {},
                body,
                query,
                signal,
                noRetry = false,
                retries,
                timeoutMs: perReqTimeout = timeoutMs,
                cache: cacheTTL = false,
                expect = 'auto',
                credentials = 'include',
            } = rest;

            const queryString = buildQuery(query);
            const url = appendQueryString(resolveUrl(baseURL, path), queryString);

            // Cache key only for GET + no body + expect auto/json/text
            const cacheKey = method === 'GET' && !body ? `GET:${url}` : null;
            if (cacheKey && cacheTTL && typeof cacheTTL === 'number') {
                const hit = cacheGet(cacheKey);
                if (hit !== undefined) return hit;
            }

            // Abort/timeout setup
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(new DOMException('Request timeout', 'TimeoutError')), perReqTimeout);
            const combinedSignal = signal
                ? new AbortController()
                : null;

            if (combinedSignal) {
                const cs = combinedSignal;
                const onAbort = () => cs.abort();
                signal.addEventListener('abort', onAbort, { once: true });
                // Chain both
                const relay = new AbortController();
                const relayAbort = () => relay.abort();
                ac.signal.addEventListener('abort', relayAbort, { once: true });
            }

            // Auto headers & body
            /** @type {RequestInit} */
            const init = { method, credentials };

            // Determine content-type and serialize if needed
            let finalHeaders = { ...headers };
            let finalBody = body;

            const isBodyAllowed = !['GET', 'HEAD'].includes(method);
            const isBinary = body instanceof Blob || body instanceof ArrayBuffer || body instanceof FormData;
            if (isBodyAllowed) {
                if (!isBinary && body !== undefined && body !== null) {
                    finalHeaders['Content-Type'] ||= 'application/json';
                    if (finalHeaders['Content-Type'].includes('application/json')) {
                        finalBody = JSON.stringify(body);
                    }
                }
                init.body = finalBody;
            }

            // Authorization
            if (typeof getBearer === 'function') {
                const token = getBearer(init);
                if (token) {
                    finalHeaders['Authorization'] = `Bearer ${token}`;
                }
            }

            init.headers = finalHeaders;
            init.signal = ac.signal;

            const doFetch = async () => {
                let res;
                try {
                    res = await fetch(url, init);
                } catch (e) {
                    // Network/abort
                    throw new ApiError({ status: 0, code: 'NETWORK', message: e?.message || 'Network error', url });
                } finally {
                    clearTimeout(timer);
                }

                const ct = res.headers.get('content-type') || '';
                const payload = await parseBody(res);

                if (!res.ok) {
                    /** @type {ApiErrorShape} */
                    const shape = {
                        status: res.status,
                        url,
                        message: res.statusText || 'Request failed',
                    };

                    // Try to lift API error { error, message, code, details }
                    if (ct.includes('application/json') && payload && typeof payload === 'object') {
                        shape.message = payload.message || payload.error || shape.message;
                        shape.code = payload.code || shape.code;
                        shape.details = payload.details ?? payload;
                    } else if (typeof payload === 'string') {
                        shape.message = payload || shape.message;
                    }
                    const err = new ApiError(shape);
                    if (err.status === 401 && typeof onUnauthorized === 'function') {
                        try {
                            onUnauthorized(err);
                        } catch (e) {
                            // swallow secondary errors from unauthorized handler but log for debugging
                            console.error(e);
                        }
                    }
                    throw err;
                }

                // If caller hints a specific type, coerce if possible
                if (expect === 'text' && typeof payload !== 'string') {
                    return typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
                }
                if (expect === 'json' && typeof payload === 'string') {
                    try { return JSON.parse(payload); } catch { /* leave as string */ }
                }
                return payload;
            };

            // Retries only for idempotent methods
            const maxAttempts = noRetry ? 1 : (retries ?? (['GET', 'HEAD'].includes(method) ? 3 : 1));
            let attempt = 0;
            for (;;) {
                try {
                    const out = await doFetch();
                    if (cacheKey && cacheTTL && typeof cacheTTL === 'number') {
                        cacheSet(cacheKey, out, cacheTTL);
                    }
                    return out;
                } catch (err) {
                    attempt++;
                    const ae = /** @type {ApiError} */(err);
                    const retriable = (ae.status === 0 || (ae.status >= 500 && ae.status < 600));
                    if (attempt >= maxAttempts || !retriable) throw err;
                    await sleep(backoff(attempt - 1));
                }
            }
        } finally {
            if (!quiet) {
                _activeCount = Math.max(0, _activeCount - 1);
                notifyActivity();
            }
        }
    }

    // Convenience HTTP verbs
    const get = (path, opts = {}) => request(path, { ...opts, method: 'GET' });
    const post = (path, body, opts = {}) => request(path, { ...opts, method: 'POST', body });
    const put = (path, body, opts = {}) => request(path, { ...opts, method: 'PUT', body });
    const patch = (path, body, opts = {}) => request(path, { ...opts, method: 'PATCH', body });
    const del = (path, opts = {}) => request(path, { ...opts, method: 'DELETE' });

    /**
     * Fetch all pages for endpoints that accept ?page & ?size (1-based or 0-based tolerant).
     * The endpoint must return { items, total, page, size } or array fallback.
     * @param {string} path
     * @param {{ query?: Record<string,any>, pageParam?: string, sizeParam?: string, size?: number, limit?: number }} [opts]
     */
    async function getAllPages(path, opts = {}) {
        const {
            query = {},
            pageParam = 'page',
            sizeParam = 'size',
            size = 50,
            limit = Infinity,
        } = opts;

        const out = [];
        let page = query[pageParam] ?? 1;

        for (;;) {
            const data = await get(path, { query: { ...query, [pageParam]: page, [sizeParam]: size } });
            if (Array.isArray(data)) {
                out.push(...data);
                if (data.length < size || out.length >= limit) break;
            } else if (data && Array.isArray(data.items)) {
                out.push(...data.items);
                const total = data.total ?? out.length;
                const gotAll = out.length >= total || data.items.length < size || out.length >= limit;
                if (gotAll) break;
            } else {
                // Unknown shape, return as-is
                return data;
            }
            page = Number(page) + 1;
        }
        return out.slice(0, limit);
    }

    return { request, get, post, put, patch, del, getAllPages };
}

// ---- Default API instance ----
// Adjust baseURL if your frontend is not served behind the same origin.
// Example: baseURL: import.meta.env.VITE_API_BASE || '/api'
const DEFAULT_API_BASE = '';
const envBaseURLRaw = (import.meta.env?.VITE_API_BASE ?? '').trim();
const normalizedBaseURL = (envBaseURLRaw || DEFAULT_API_BASE).replace(/\/$/, '');
const DEFAULT_REALTIME_BASE = '';
const envRealtimeBaseRaw = (
    import.meta.env?.VITE_REALTIME_URL ??
    import.meta.env?.VITE_REALTIME_BASE ??
    ''
).trim();
const normalizedRealtimeBase = (envRealtimeBaseRaw || DEFAULT_REALTIME_BASE).replace(/\/$/, '');

function normalizeRealtimeBase(raw) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) return '';

    if (/^wss?:\/\//i.test(value)) {
        try {
            return new URL(value).toString().replace(/\/+$/, '');
        } catch {
            return value.replace(/\/+$/, '');
        }
    }

    if (/^https?:\/\//i.test(value)) {
        try {
            const url = new URL(value);
            url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
            url.search = '';
            url.hash = '';
            url.pathname = url.pathname.replace(/\/+$/, '') || '/';
            return url.toString().replace(/\/+$/, '');
        } catch {
            return '';
        }
    }

    if (/^\/\//.test(value)) {
        const protocol = typeof window !== 'undefined' && window.location?.protocol === 'https:'
            ? 'wss:'
            : 'ws:';
        return `${protocol}${value.replace(/\/+$/, '')}`;
    }

    if (/^[A-Za-z0-9.-]+(?::\d+)?(?:\/.*)?$/.test(value)) {
        const protocol = typeof window !== 'undefined' && window.location?.protocol === 'https:'
            ? 'wss:'
            : 'ws:';
        return `${protocol}//${value.replace(/\/+$/, '')}`;
    }

    return '';
}

export function resolveRealtimeUrl(path = '/ws') {
    const normalizedPath = typeof path === 'string' && path.startsWith('/') ? path : `/${path ?? ''}`;
    const candidates = [normalizedRealtimeBase, normalizedBaseURL];

    for (const candidate of candidates) {
        const base = normalizeRealtimeBase(candidate);
        if (!base) continue;
        try {
            return new URL(normalizedPath, base).toString();
        } catch {
            return `${base}${normalizedPath}`;
        }
    }

    if (typeof window !== 'undefined' && window.location) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${window.location.host}${normalizedPath}`;
    }

    return normalizedPath;
}

export const apiClient = createApi({
    baseURL: normalizedBaseURL,
    timeoutMs: 12_000,
    // Optional: wire a bearer token provider if you also support header-based auth
    getBearer: () => {
        // e.g., return localStorage.getItem('noona_token') || undefined;
        return undefined;
    },
    onUnauthorized: () => {
        // e.g., dispatch logout, redirect, or toast
        // console.warn('Unauthorized');
    },
});

// Back-compat shim for your existing code that called `api(path, opts)`
/**
 * @param {string} path
 * @param {import('./api').RequestOptions} [opts]
 */
export const api = (path, opts) => apiClient.request(path, opts);

// ---------------- Specific Domain Facades ----------------

export const Auth = {
    me: () => api('/api/auth/me', { cache: 3000 }),
    login: (username, password) => api('/api/auth/login', {
        method: 'POST',
        body: { username, password },
        noRetry: true,
    }),
    register: (username, password) => api('/api/auth/register', {
        method: 'POST',
        body: { username, password },
        noRetry: true,
    }),
    logout: () => api('/api/auth/logout', { method: 'POST', noRetry: true }),
};

export const Games = {
    list: (query) => api('/api/games', { query }),
    create: (name) => api('/api/games', { method: 'POST', body: { name } }),
    get: (id) => api(`/api/games/${encodeURIComponent(id)}`),
    invite: (id) => api(`/api/games/${encodeURIComponent(id)}/invites`, { method: 'POST' }),
    delete: (id) => api(`/api/games/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    joinByCode: (code) => api(`/api/games/join/${encodeURIComponent(code)}`, { method: 'POST' }),
    setPerms: (id, perms) => api(`/api/games/${encodeURIComponent(id)}/permissions`, { method: 'PUT', body: perms }),
    saveCharacter: (id, character) => api(`/api/games/${encodeURIComponent(id)}/character`, { method: 'PUT', body: { character } }),
    addCombatSkill: (id, skill, options = {}) => {
        const targetUserId =
            typeof options.userId === 'string' && options.userId.trim() ? options.userId.trim() : null;
        const body = targetUserId ? { skill, targetUserId } : { skill };
        return api(`/api/games/${encodeURIComponent(id)}/combat-skills`, { method: 'POST', body });
    },
    updateCombatSkill: (id, skillId, skill, options = {}) => {
        const targetUserId =
            typeof options.userId === 'string' && options.userId.trim() ? options.userId.trim() : null;
        const body = targetUserId ? { skill, targetUserId } : { skill };
        return api(`/api/games/${encodeURIComponent(id)}/combat-skills/${encodeURIComponent(skillId)}`, {
            method: 'PUT',
            body,
        });
    },
    deleteCombatSkill: (id, skillId, options = {}) => {
        const targetUserId =
            typeof options.userId === 'string' && options.userId.trim() ? options.userId.trim() : null;
        const request = { method: 'DELETE' };
        if (targetUserId) {
            request.body = { targetUserId };
        }
        return api(`/api/games/${encodeURIComponent(id)}/combat-skills/${encodeURIComponent(skillId)}`, request);
    },
    addWorldSkill: (id, skill) =>
        api(`/api/games/${encodeURIComponent(id)}/world-skills`, { method: 'POST', body: { skill } }),
    updateWorldSkill: (id, skillId, skill) =>
        api(`/api/games/${encodeURIComponent(id)}/world-skills/${encodeURIComponent(skillId)}`, {
            method: 'PUT',
            body: { skill },
        }),
    deleteWorldSkill: (id, skillId) =>
        api(`/api/games/${encodeURIComponent(id)}/world-skills/${encodeURIComponent(skillId)}`, { method: 'DELETE' }),
    addCustomItem: (id, item) => api(`/api/games/${encodeURIComponent(id)}/items/custom`, { method: 'POST', body: { item } }),
    updateCustomItem: (id, itemId, item) => api(`/api/games/${encodeURIComponent(id)}/items/custom/${encodeURIComponent(itemId)}`, { method: 'PUT', body: { item } }),
    deleteCustomItem: (id, itemId) => api(`/api/games/${encodeURIComponent(id)}/items/custom/${encodeURIComponent(itemId)}`, { method: 'DELETE' }),
    adjustPlayerMacca: (id, playerId, delta) =>
        api(`/api/games/${encodeURIComponent(id)}/players/${encodeURIComponent(playerId)}/macca`, {
            method: 'POST',
            body: { delta },
        }),
    addPlayerItem: (id, playerId, item) => api(`/api/games/${encodeURIComponent(id)}/players/${encodeURIComponent(playerId)}/items`, { method: 'POST', body: { item } }),
    updatePlayerItem: (id, playerId, itemId, item) => api(`/api/games/${encodeURIComponent(id)}/players/${encodeURIComponent(playerId)}/items/${encodeURIComponent(itemId)}`, { method: 'PUT', body: { item } }),
    deletePlayerItem: (id, playerId, itemId) => api(`/api/games/${encodeURIComponent(id)}/players/${encodeURIComponent(playerId)}/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' }),
    consumePlayerItem: (id, playerId, itemId) =>
        api(
            `/api/games/${encodeURIComponent(id)}/players/${encodeURIComponent(playerId)}/items/${encodeURIComponent(itemId)}/use`,
            { method: 'POST' },
        ),
    removePlayer: (id, playerId) => api(`/api/games/${encodeURIComponent(id)}/players/${encodeURIComponent(playerId)}`, { method: 'DELETE' }),
    addPlayerGearBag: (id, playerId, item) =>
        api(`/api/games/${encodeURIComponent(id)}/players/${encodeURIComponent(playerId)}/gear/bag`, {
            method: 'POST',
            body: { item },
        }),
    updatePlayerGearBag: (id, playerId, itemId, item) =>
        api(
            `/api/games/${encodeURIComponent(id)}/players/${encodeURIComponent(playerId)}/gear/bag/${encodeURIComponent(itemId)}`,
            { method: 'PUT', body: { item } }
        ),
    deletePlayerGearBag: (id, playerId, itemId) =>
        api(
            `/api/games/${encodeURIComponent(id)}/players/${encodeURIComponent(playerId)}/gear/bag/${encodeURIComponent(itemId)}`,
            { method: 'DELETE' }
        ),
    setPlayerGear: (id, playerId, slot, payload) =>
        api(`/api/games/${encodeURIComponent(id)}/players/${encodeURIComponent(playerId)}/gear/${encodeURIComponent(slot)}`, {
            method: 'PUT',
            body: payload,
        }),
    clearPlayerGear: (id, playerId, slot) => api(`/api/games/${encodeURIComponent(id)}/players/${encodeURIComponent(playerId)}/gear/${encodeURIComponent(slot)}`, { method: 'DELETE' }),
    addCustomGear: (id, item) => api(`/api/games/${encodeURIComponent(id)}/gear/custom`, { method: 'POST', body: { item } }),
    updateCustomGear: (id, itemId, item) => api(`/api/games/${encodeURIComponent(id)}/gear/custom/${encodeURIComponent(itemId)}`, { method: 'PUT', body: { item } }),
    deleteCustomGear: (id, itemId) => api(`/api/games/${encodeURIComponent(id)}/gear/custom/${encodeURIComponent(itemId)}`, { method: 'DELETE' }),
    addDemon: (id, body) => api(`/api/games/${encodeURIComponent(id)}/demons`, { method: 'POST', body }),
    updateDemon: (id, demonId, body) => api(`/api/games/${encodeURIComponent(id)}/demons/${encodeURIComponent(demonId)}`, { method: 'PUT', body }),
    delDemon: (id, demonId) => api(`/api/games/${encodeURIComponent(id)}/demons/${encodeURIComponent(demonId)}`, { method: 'DELETE' }),
    updateFusionChart: (id, payload) =>
        api(`/api/games/${encodeURIComponent(id)}/fusion-chart`, { method: 'PUT', body: payload }),

    updateMapSettings: (id, settings) =>
        api(`/api/games/${encodeURIComponent(id)}/map/settings`, {
            method: 'PUT',
            body: settings,
            quiet: true,
        }),
    getMap: (id) => api(`/api/games/${encodeURIComponent(id)}/map`, { quiet: true }),
    addMapStroke: (id, stroke) =>
        api(`/api/games/${encodeURIComponent(id)}/map/strokes`, {
            method: 'POST',
            body: { stroke },
            quiet: true,
        }),
    deleteMapStroke: (id, strokeId) =>
        api(`/api/games/${encodeURIComponent(id)}/map/strokes/${encodeURIComponent(strokeId)}`, {
            method: 'DELETE',
            quiet: true,
        }),
    clearMapStrokes: (id) =>
        api(`/api/games/${encodeURIComponent(id)}/map/strokes/clear`, {
            method: 'POST',
            quiet: true,
        }),
    addMapShape: (id, shape) =>
        api(`/api/games/${encodeURIComponent(id)}/map/shapes`, {
            method: 'POST',
            body: { shape },
            quiet: true,
        }),
    updateMapShape: (id, shapeId, payload) =>
        api(`/api/games/${encodeURIComponent(id)}/map/shapes/${encodeURIComponent(shapeId)}`, {
            method: 'PUT',
            body: payload,
            quiet: true,
        }),
    deleteMapShape: (id, shapeId) =>
        api(`/api/games/${encodeURIComponent(id)}/map/shapes/${encodeURIComponent(shapeId)}`, {
            method: 'DELETE',
            quiet: true,
        }),
    updateMapBackground: (id, payload) =>
        api(`/api/games/${encodeURIComponent(id)}/map/background`, {
            method: 'PUT',
            body: payload,
            quiet: true,
        }),
    clearMapBackground: (id) =>
        api(`/api/games/${encodeURIComponent(id)}/map/background`, {
            method: 'DELETE',
            quiet: true,
        }),
    clearMap: (id) =>
        api(`/api/games/${encodeURIComponent(id)}/map/clear`, {
            method: 'POST',
            quiet: true,
        }),
    logBattleEvent: (id, entry) =>
        api(`/api/games/${encodeURIComponent(id)}/map/battle-log`, {
            method: 'POST',
            body: entry,
            quiet: true,
        }),
    startCombat: (id, payload) =>
        api(`/api/games/${encodeURIComponent(id)}/map/combat/start`, {
            method: 'POST',
            body: payload,
            quiet: true,
        }),
    nextCombatTurn: (id, payload) =>
        api(`/api/games/${encodeURIComponent(id)}/map/combat/next`, {
            method: 'POST',
            body: payload,
            quiet: true,
        }),
    endCombat: (id) =>
        api(`/api/games/${encodeURIComponent(id)}/map/combat/end`, {
            method: 'POST',
            quiet: true,
        }),
    addMapToken: (id, token) =>
        api(`/api/games/${encodeURIComponent(id)}/map/tokens`, {
            method: 'POST',
            body: token,
            quiet: true,
        }),
    updateMapToken: (id, tokenId, payload) =>
        api(`/api/games/${encodeURIComponent(id)}/map/tokens/${encodeURIComponent(tokenId)}`, {
            method: 'PUT',
            body: payload,
            quiet: true,
        }),
    deleteMapToken: (id, tokenId) =>
        api(`/api/games/${encodeURIComponent(id)}/map/tokens/${encodeURIComponent(tokenId)}`, {
            method: 'DELETE',
            quiet: true,
        }),
    listMapLibrary: async (id) => {
        const result = await api(`/api/games/${encodeURIComponent(id)}/map/library`, { quiet: true });
        return Array.isArray(result?.maps) ? result.maps : [];
    },
    saveMapLibrary: (id, name) =>
        api(`/api/games/${encodeURIComponent(id)}/map/library`, {
            method: 'POST',
            body: { name },
            quiet: true,
        }),
    deleteMapLibrary: (id, entryId) =>
        api(`/api/games/${encodeURIComponent(id)}/map/library/${encodeURIComponent(entryId)}`, {
            method: 'DELETE',
            quiet: true,
        }),
    loadMapLibrary: (id, entryId) =>
        api(`/api/games/${encodeURIComponent(id)}/map/library/${encodeURIComponent(entryId)}/load`, {
            method: 'POST',
            quiet: true,
        }),

    // Optional: full pagination helper example if the backend supports it
    listAll: (query) => apiClient.getAllPages('/api/games', { query }),
};

export const Items = {
    premade: () => api('/api/items/premade', { cache: 10_000 }),
};

export const Help = {
    docs: () => api('/api/help/docs', { cache: 10_000 }),
    getDoc: (filename) =>
        api(`/txtdocs/${encodeURIComponent(filename)}`, { expect: 'text' }),
};

export const Personas = {
    list: (params) => api('/api/personas', { query: params, cache: 5000 }),
    search: (q) => api('/api/personas/search', { query: { q }, cache: 5000 }),
    get: (slug) => api(`/api/personas/${encodeURIComponent(slug)}`, { cache: 5000 }),
};

export const StoryLogs = {
    /**
     * Fetch the latest Discord story snapshot for the supplied campaign.
     *
     * @param {string} gameId
     * @returns {Promise<any>}
     */
    fetch: (gameId) => api(`/api/games/${encodeURIComponent(gameId)}/story-log`),

    /**
     * Post a message to the campaign's configured Discord webhook.
     * The payload mirrors the server's persona selection schema.
     *
     * @param {string} gameId
     * @param {{ persona?: string, targetUserId?: string, content: string }} payload
     * @returns {Promise<any>}
     */
    post: (gameId, payload) =>
        api(`/api/games/${encodeURIComponent(gameId)}/story-log/messages`, {
            method: 'POST',
            body: payload,
        }),

    delete: (gameId, messageId) =>
        api(`/api/games/${encodeURIComponent(gameId)}/story-log/messages/${encodeURIComponent(messageId)}`, {
            method: 'DELETE',
        }),

    /**
     * Update the Discord story configuration for a campaign.
     *
     * @param {string} gameId
     * @param {{
     *   channelId?: string,
     *   guildId?: string,
     *   webhookUrl?: string,
     *   botToken?: string,
     *   allowPlayerPosts?: boolean,
     *   scribeIds?: string[],
     *   pollIntervalMs?: number
     * }} payload
     * @returns {Promise<any>}
     */
    configure: (gameId, payload) =>
        api(`/api/games/${encodeURIComponent(gameId)}/story-config`, {
            method: 'PUT',
            body: payload,
        }),
};

// ---------------- Helper: SSE (Server-Sent Events) ----------------
// If you later expose real-time updates from the server, you can wire them here.
/*
export function openSSE(path, { query, withCredentials = true, onMessage, onError } = {}) {
  const url = `${path}${buildQuery(query)}`;
  const es = new EventSource(url, { withCredentials });
  if (onMessage) es.addEventListener('message', (ev) => onMessage(ev.data));
  if (onError) es.addEventListener('error', (err) => onError(err));
  return () => es.close();
}
*/
