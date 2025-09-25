import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
export const DEFAULT_ITEMS_PATH = path.join(repoRoot, 'data', 'premade-items.json');

function truncate(value, max = 1000) {
    if (value == null) return '';
    const str = String(value).trim();
    if (max > 0 && str.length > max) {
        return str.slice(0, max);
    }
    return str;
}

function slugifySegment(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function normalizeItemSlug(value) {
    return slugifySegment(value);
}

export function buildItemSlug(...parts) {
    const segments = parts
        .map((part) => slugifySegment(part))
        .filter(Boolean);
    return segments.join('-');
}

function cleanLabel(value) {
    return truncate(value, 120);
}

function determineType(explicitType, category, subcategory) {
    const type = truncate(explicitType, 120);
    if (type) return type;
    const base = truncate(category, 120);
    const sub = truncate(subcategory, 120);
    const lower = base.toLowerCase();
    if (lower === 'weapons') {
        return sub ? `Weapon - ${sub}` : 'Weapon';
    }
    if (lower === 'armor') {
        return sub ? `Armor - ${sub}` : 'Armor';
    }
    if (lower === 'accessories') {
        return 'Accessory';
    }
    if (lower === 'restoratives') {
        return 'Restorative';
    }
    if (lower === 'consumables') {
        return 'Consumable';
    }
    if (lower === 'tools') {
        return 'Tool';
    }
    return base;
}

function toArray(value) {
    if (!Array.isArray(value)) return [];
    return value;
}

export function parseHealingEffect(description) {
    const desc = typeof description === 'string' ? description : '';
    if (!desc) return null;
    const effect = {};
    const percentRegex = /(?:restore|restores|restoring|recover|recovers)\s+(\d+)\s*%\s*(hp|mp)/gi;
    let match;
    while ((match = percentRegex.exec(desc)) !== null) {
        const amount = Number(match[1]);
        const target = match[2].toLowerCase();
        if (!Number.isFinite(amount) || amount <= 0) continue;
        if (target === 'hp') {
            effect.hpPercent = Math.max(effect.hpPercent || 0, amount);
        } else if (target === 'mp') {
            effect.mpPercent = Math.max(effect.mpPercent || 0, amount);
        }
    }

    const flatRegex = /(?:restore|restores|restoring|recover|recovers)\s+(\d+)(?!\s*%)\s*(hp|mp)\b/gi;
    while ((match = flatRegex.exec(desc)) !== null) {
        const amount = Number(match[1]);
        const target = match[2].toLowerCase();
        if (!Number.isFinite(amount) || amount <= 0) continue;
        if (target === 'hp') {
            effect.hp = Math.max(effect.hp || 0, amount);
        } else if (target === 'mp') {
            effect.mp = Math.max(effect.mp || 0, amount);
        }
    }

    const reviveRegex = /reviv(?:e|es|al)[^.]*?(\d+)\s*%\s*hp/gi;
    while ((match = reviveRegex.exec(desc)) !== null) {
        const amount = Number(match[1]);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        effect.hpPercent = Math.max(effect.hpPercent || 0, amount);
        effect.revive = amount >= 100 ? 'full' : 'partial';
    }

    const reviveFlat = /reviv(?:e|es|al)[^.]*?(\d+)(?!\s*%)\s*hp/gi;
    while ((match = reviveFlat.exec(desc)) !== null) {
        const amount = Number(match[1]);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        effect.hp = Math.max(effect.hp || 0, amount);
        if (!effect.revive) {
            effect.revive = 'partial';
        }
    }

    if (/reviv/i.test(desc)) {
        if (/full|max|100%/i.test(desc)) {
            effect.revive = 'full';
        } else if (!effect.revive) {
            effect.revive = 'partial';
        }
    }

    if (effect.hpPercent && !effect.mpPercent && /hp\s+and\s+mp/i.test(desc)) {
        effect.mpPercent = effect.hpPercent;
    }
    if (effect.mpPercent && !effect.hpPercent && /mp\s+and\s+hp/i.test(desc)) {
        effect.hpPercent = effect.mpPercent;
    }

    if (Object.keys(effect).length === 0) {
        return null;
    }
    return effect;
}

function normalizeItemRecord(source, { category, subcategory, order }) {
    if (!source || typeof source !== 'object') return null;
    const name = truncate(source.name, 200);
    if (!name) return null;
    const desc = truncate(source.desc, 1000);
    const type = determineType(source.type, category, subcategory);
    const slot = truncate(source.slot, 120);
    const tags = toArray(source.tags)
        .map((tag) => truncate(tag, 80))
        .filter(Boolean);
    const normalizedCategory = cleanLabel(category || source.category || '');
    const normalizedSubcategory = cleanLabel(subcategory || source.subcategory || '');
    const slug = buildItemSlug(normalizedCategory || type || 'item', normalizedSubcategory, name);
    const healing = parseHealingEffect(desc || source.effect || '');
    return {
        slug,
        name,
        category: normalizedCategory,
        subcategory: normalizedSubcategory,
        type: cleanLabel(type),
        desc,
        slot,
        tags,
        order,
        ...(healing ? { healing } : {}),
    };
}

function flattenModernStructure(raw) {
    const entries = [];
    let order = 0;
    for (const [category, value] of Object.entries(raw || {})) {
        if (!value) continue;
        if (Array.isArray(value)) {
            for (const item of value) {
                const record = normalizeItemRecord(item, { category, subcategory: '', order: order++ });
                if (record) entries.push(record);
            }
        } else if (typeof value === 'object') {
            for (const [subcategory, list] of Object.entries(value)) {
                if (!Array.isArray(list)) continue;
                for (const item of list) {
                    const record = normalizeItemRecord(item, { category, subcategory, order: order++ });
                    if (record) entries.push(record);
                }
            }
        }
    }
    return entries;
}

function flattenLegacyArray(raw) {
    const entries = [];
    let order = 0;
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const type = typeof item.type === 'string' ? item.type : '';
        let category = item.category;
        let subcategory = '';
        if (!category && type) {
            const parts = type.split('-').map((part) => part.trim()).filter(Boolean);
            if (parts.length > 1) {
                [category, subcategory] = parts;
            } else if (parts.length === 1) {
                [category] = parts;
            }
        }
        const record = normalizeItemRecord(item, { category, subcategory, order: order++ });
        if (record) entries.push(record);
    }
    return entries;
}

function buildEntries(raw) {
    if (Array.isArray(raw)) {
        return flattenLegacyArray(raw);
    }
    if (raw && typeof raw === 'object') {
        return flattenModernStructure(raw);
    }
    throw new Error('Expected premade items JSON to be an array or object.');
}

export async function loadItemEntries({ file = DEFAULT_ITEMS_PATH } = {}) {
    const content = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(content);
    const entries = buildEntries(parsed);
    return entries;
}
