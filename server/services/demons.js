import Demon from '../models/Demon.js';

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

    const docs = await Demon.find(filters)
        .sort({ level: 1, name: 1 })
        .limit(Math.max(1, Math.min(100, limit)))
        .lean();

    return docs.map((doc) => sanitizeDemonDoc(doc));
}

export async function findDemonBySlug(slug) {
    if (typeof slug !== 'string' || !slug.trim()) return null;
    const normalized = slug.trim().toLowerCase();
    const doc = await Demon.findOne({ slug: normalized }).lean();
    return sanitizeDemonDoc(doc);
}

export async function findClosestDemon(term, { threshold = 0.45 } = {}) {
    const normalized = normalizeComparisonTerm(term);
    if (!normalized) return null;
    const docs = await Demon.find({}, { slug: 1, name: 1, searchTerms: 1 })
        .limit(1500)
        .lean();
    let best = null;
    for (const doc of docs) {
        const options = new Set([
            doc.slug,
            doc.name,
            ...(Array.isArray(doc.searchTerms) ? doc.searchTerms : []),
        ]);
        for (const option of options) {
            const normalizedOption = normalizeComparisonTerm(option);
            if (!normalizedOption) continue;
            const distance = levenshtein(normalized, normalizedOption);
            const maxLen = Math.max(normalized.length, normalizedOption.length, 1);
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

export function summarizeDemon(demon) {
    if (!demon) return null;
    const stats = demon.stats || {};
    const resist = demon.resistances || {};
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
            weak: Array.isArray(resist.weak) ? resist.weak : [],
            resist: Array.isArray(resist.resist) ? resist.resist : [],
            null: Array.isArray(resist.null) ? resist.null : [],
            absorb: Array.isArray(resist.absorb) ? resist.absorb : [],
            reflect: Array.isArray(resist.reflect) ? resist.reflect : [],
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

