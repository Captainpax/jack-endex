import Demon from '../models/Demon.js';
import { loadDemonEntries } from '../lib/demonImport.js';

const DB_READY_STATE_CONNECTED = 1;
let localDemonCachePromise = null;

async function loadLocalDemonCache() {
    if (!localDemonCachePromise) {
        localDemonCachePromise = (async () => {
            try {
                const rawEntries = await loadDemonEntries();
                const entries = rawEntries.map((entry) => {
                    const searchParts = new Set();
                    searchParts.add(entry.slug);
                    searchParts.add(entry.name);
                    searchParts.add(entry.arcana);
                    searchParts.add(entry.alignment);
                    searchParts.add(entry.description);
                    if (Array.isArray(entry.tags)) {
                        for (const tag of entry.tags) searchParts.add(tag);
                    }
                    if (Array.isArray(entry.searchTerms)) {
                        for (const term of entry.searchTerms) searchParts.add(term);
                    }
                    if (Array.isArray(entry.skills)) {
                        for (const skill of entry.skills) {
                            if (!skill) continue;
                            if (typeof skill === 'string') {
                                searchParts.add(skill);
                            } else if (skill.name) {
                                searchParts.add(skill.name);
                            }
                        }
                    }
                    const parts = Array.from(searchParts)
                        .map((value) => (typeof value === 'string' ? value.trim() : String(value ?? '')).toLowerCase())
                        .filter(Boolean);
                    const searchText = parts.join(' ');
                    const comparison = parts.map((value) => normalizeComparisonTerm(value)).filter(Boolean);
                    return {
                        ...entry,
                        _searchText: searchText,
                        _comparisonTerms: comparison,
                    };
                });
                const bySlug = new Map();
                for (const entry of entries) {
                    if (!entry?.slug) continue;
                    bySlug.set(entry.slug, entry);
                }
                return { entries, bySlug };
            } catch (err) {
                console.warn('[demons] Failed to load local demon cache:', err);
                return { entries: [], bySlug: new Map() };
            }
        })();
    }
    return localDemonCachePromise;
}

function sanitizeLocalDemon(entry) {
    if (!entry) return null;
    const { slug, ...rest } = entry;
    return {
        ...rest,
        slug,
        query: slug,
    };
}

function isDatabaseReady() {
    return Demon?.db?.readyState === DB_READY_STATE_CONNECTED;
}

function sanitizeDemonDoc(doc) {
    if (!doc) return null;
    const {
        _id,
        __v,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        slug,
        ...rest
    } = doc;
    return {
        ...rest,
        slug,
        query: slug,
    };
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildLooseRegex(query) {
    if (!query) return null;
    const tokens = query
        .split(/\s+/)
        .map((part) => escapeRegExp(part))
        .filter(Boolean);
    if (tokens.length === 0) return null;
    return new RegExp(tokens.join('.*'), 'i');
}

function normalizeSearchTerm(value) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, 64);
}

function normalizeComparisonTerm(value) {
    if (typeof value !== 'string') return '';
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function levenshtein(a, b) {
    const lenA = a.length;
    const lenB = b.length;
    if (lenA === 0) return lenB;
    if (lenB === 0) return lenA;

    const prev = new Array(lenB + 1);
    const curr = new Array(lenB + 1);
    for (let j = 0; j <= lenB; j += 1) prev[j] = j;

    for (let i = 1; i <= lenA; i += 1) {
        curr[0] = i;
        const charA = a[i - 1];
        for (let j = 1; j <= lenB; j += 1) {
            const charB = b[j - 1];
            if (charA === charB) {
                curr[j] = prev[j - 1];
            } else {
                curr[j] = Math.min(prev[j - 1], prev[j], curr[j - 1]) + 1;
            }
        }
        for (let j = 0; j <= lenB; j += 1) {
            prev[j] = curr[j];
        }
    }
    return prev[lenB];
}

export async function searchDemons(term, { limit = 25 } = {}) {
    const query = normalizeSearchTerm(term);
    if (!query) return [];

    const regex = buildLooseRegex(query);
    const normalizedLimit = Math.max(1, Math.min(100, limit));

    if (isDatabaseReady()) {
        const filters = regex
            ? {
                $or: [
                    { slug: regex },
                    { name: regex },
                    { arcana: regex },
                    { alignment: regex },
                    { tags: regex },
                    { searchTerms: regex },
                    { description: regex },
                    { skills: regex },
                ],
            }
            : {};

        try {
            const docs = await Demon.find(filters)
                .sort({ level: 1, name: 1 })
                .limit(normalizedLimit)
                .lean();
            if (docs.length > 0) {
                return docs.map((doc) => sanitizeDemonDoc(doc));
            }
        } catch (err) {
            console.warn('[demons] Falling back to local demon search:', err);
        }
    }

    const { entries } = await loadLocalDemonCache();
    if (!Array.isArray(entries) || entries.length === 0) return [];

    const fallbackTerm = query.toLowerCase();
    const matches = [];
    for (const entry of entries) {
        const searchText = entry?._searchText || '';
        if (!searchText) continue;
        const hit = regex ? regex.test(searchText) : searchText.includes(fallbackTerm);
        if (hit) {
            matches.push(entry);
        }
    }

    matches.sort((a, b) => {
        const levelA = Number(a.level) || 0;
        const levelB = Number(b.level) || 0;
        if (levelA !== levelB) return levelA - levelB;
        const nameA = String(a.name || '');
        const nameB = String(b.name || '');
        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });

    return matches
        .slice(0, normalizedLimit)
        .map((entry) => sanitizeLocalDemon(entry))
        .filter(Boolean);
}

export async function findDemonBySlug(slug) {
    if (typeof slug !== 'string' || !slug.trim()) return null;
    const normalized = slug.trim().toLowerCase();
    if (isDatabaseReady()) {
        try {
            const doc = await Demon.findOne({ slug: normalized }).lean();
            if (doc) return sanitizeDemonDoc(doc);
        } catch (err) {
            console.warn('[demons] Failed to query demon by slug from Mongo, trying local cache:', err);
        }
    }

    const { bySlug } = await loadLocalDemonCache();
    return sanitizeLocalDemon(bySlug.get(normalized));
}

export async function findClosestDemon(term, { threshold = 0.45 } = {}) {
    const normalized = normalizeComparisonTerm(term);
    if (!normalized) return null;
    if (isDatabaseReady()) {
        try {
            const docs = await Demon.find({}, { slug: 1, name: 1, searchTerms: 1 })
                .limit(1500)
                .lean();
            const best = computeClosestMatch(normalized, docs, threshold);
            if (best) return best;
        } catch (err) {
            console.warn('[demons] findClosest fallback to local cache:', err);
        }
    }

    const { entries } = await loadLocalDemonCache();
    return computeClosestMatch(normalized, entries, threshold);
}

export function summarizeDemon(demon) {
    if (!demon) return null;
    const stats = demon.stats || {};
    const resist = demon.resistances || {};
    const aliasMap = {
        weak: ['weak', 'weaks'],
        resist: ['resist', 'resists'],
        block: ['block', 'blocks', 'null', 'nullify', 'nullifies'],
        drain: ['drain', 'drains', 'absorb', 'absorbs'],
        reflect: ['reflect', 'reflects'],
    };
    const collect = (...keys) => {
        const values = new Set();
        for (const key of keys) {
            const aliases = aliasMap[key] || [key];
            for (const alias of aliases) {
                const primary = resist?.[alias];
                if (Array.isArray(primary)) {
                    for (const entry of primary) {
                        if (!entry) continue;
                        values.add(entry);
                    }
                } else if (typeof primary === 'string' && primary.trim()) {
                    values.add(primary.trim());
                }
                const fallback = demon?.[alias];
                if (Array.isArray(fallback)) {
                    for (const entry of fallback) {
                        if (!entry) continue;
                        values.add(entry);
                    }
                } else if (typeof fallback === 'string' && fallback.trim()) {
                    values.add(fallback.trim());
                }
            }
        }
        return Array.from(values);
    };
    return {
        name: demon.name,
        arcana: demon.arcana || '',
        alignment: demon.alignment || '',
        level: demon.level ?? null,
        description: demon.description || '',
        image: demon.image || '',
        stats,
        mods: demon.mods || {},
        resistances: {
            weak: collect('weak'),
            resist: collect('resist'),
            block: collect('block', 'null'),
            drain: collect('drain', 'absorb'),
            reflect: collect('reflect'),
        },
        skills: Array.isArray(demon.skills) ? demon.skills : [],
        slug: demon.slug,
        query: demon.slug,
    };
}

export function buildDemonDetailString(demon) {
    const parts = [];
    if (demon.arcana) parts.push(`Arcana: ${demon.arcana}`);
    if (demon.alignment) parts.push(`Alignment: ${demon.alignment}`);
    if (Number.isFinite(demon.level)) parts.push(`Level ${demon.level}`);
    if (parts.length === 0) return 'Uncatalogued demon';
    return parts.join(' · ');
}

function computeClosestMatch(normalizedTerm, docs, threshold) {
    if (!Array.isArray(docs) || docs.length === 0) return null;
    let best = null;
    for (const doc of docs) {
        if (!doc) continue;
        const options = new Set([
            doc.slug,
            doc.name,
            ...(Array.isArray(doc.searchTerms) ? doc.searchTerms : []),
            ...(Array.isArray(doc._comparisonTerms) ? doc._comparisonTerms : []),
        ]);
        for (const option of options) {
            const normalizedOption = normalizeComparisonTerm(option);
            if (!normalizedOption) continue;
            const distance = levenshtein(normalizedTerm, normalizedOption);
            const maxLen = Math.max(normalizedTerm.length, normalizedOption.length, 1);
            const ratio = distance / maxLen;
            if (ratio <= threshold) {
                if (!best || ratio < best.ratio) {
                    best = {
                        ratio,
                        distance,
                        slug: doc.slug,
                        name: doc.name,
                    };
                }
            }
        }
    }
    return best;
}

export async function listDemons({ arcana, limit = 200 } = {}) {
    const normalizedLimit = Math.max(1, Math.min(200, Number(limit) || 200));
    const arcanaValue = typeof arcana === 'string' ? arcana.trim() : '';
    const arcanaRegex = arcanaValue ? new RegExp(`^${escapeRegExp(arcanaValue)}$`, 'i') : null;

    if (isDatabaseReady()) {
        const filters = arcanaRegex ? { arcana: arcanaRegex } : {};
        try {
            const docs = await Demon.find(filters)
                .sort({ level: 1, name: 1 })
                .limit(normalizedLimit)
                .lean();
            if (docs.length > 0) {
                return docs.map((doc) => sanitizeDemonDoc(doc));
            }
        } catch (err) {
            console.warn('[demons] listDemons fell back to local cache:', err);
        }
    }

    const { entries } = await loadLocalDemonCache();
    if (!Array.isArray(entries) || entries.length === 0) return [];

    let filtered = entries;
    if (arcanaRegex) {
        filtered = filtered.filter((entry) => arcanaRegex.test(String(entry.arcana || '')));
    }

    const sorted = [...filtered].sort((a, b) => {
        const levelA = Number(a.level) || 0;
        const levelB = Number(b.level) || 0;
        if (levelA !== levelB) return levelA - levelB;
        const nameA = String(a.name || '');
        const nameB = String(b.name || '');
        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });

    return sorted
        .slice(0, normalizedLimit)
        .map((entry) => sanitizeLocalDemon(entry))
        .filter(Boolean);
}

