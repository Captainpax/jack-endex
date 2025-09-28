import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
export const DEFAULT_ITEMS_PATH = path.join(repoRoot, 'data', 'premade-items.json');

function cloneEntry(entry) {
    return JSON.parse(JSON.stringify(entry ?? {}));
}

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

function normalizeTagsInput(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value
            .map((item) => truncate(item, 80))
            .map((item) => item.trim())
            .filter(Boolean);
    }
    if (typeof value === 'string') {
        return value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
            .map((item) => truncate(item, 80));
    }
    return [];
}

function normalizeEffectsInput(effects) {
    if (!Array.isArray(effects)) return [];
    return effects
        .map((effect) => (effect && typeof effect === 'object' ? { ...effect } : null))
        .filter(Boolean);
}

function normalizeOrderValue(value, fallback) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
    return Number.isFinite(fallback) ? fallback : 0;
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

export function updateItemEntry(entry, updates = {}) {
    if (!entry || typeof entry !== 'object') {
        throw new Error('Invalid item entry');
    }
    const next = cloneEntry(entry);
    const stringFields = ['name', 'type', 'desc', 'category', 'subcategory', 'slot'];
    for (const field of stringFields) {
        if (Object.prototype.hasOwnProperty.call(updates, field)) {
            const value = updates[field];
            next[field] = truncate(typeof value === 'string' ? value.trim() : '', field === 'desc' ? 1000 : 200);
        }
        if (typeof next[field] !== 'string') {
            next[field] = '';
        }
        if (field !== 'desc') {
            next[field] = truncate(next[field], field === 'type' || field === 'slot' ? 120 : 200);
        }
    }

    if (!next.name) {
        throw new Error('Item name is required');
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'tags')) {
        next.tags = normalizeTagsInput(updates.tags);
    } else if (!Array.isArray(next.tags)) {
        next.tags = [];
    } else {
        next.tags = normalizeTagsInput(next.tags);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'order')) {
        next.order = normalizeOrderValue(updates.order, next.order);
    } else {
        next.order = normalizeOrderValue(next.order, 0);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'effects')) {
        next.effects = normalizeEffectsInput(updates.effects);
    } else if (Array.isArray(next.effects)) {
        next.effects = normalizeEffectsInput(next.effects);
    }

    const categoryLabel = cleanLabel(next.category || entry.category || '');
    const subcategoryLabel = cleanLabel(next.subcategory || entry.subcategory || '');
    next.category = categoryLabel;
    next.subcategory = subcategoryLabel;
    next.type = truncate(next.type || determineType(entry.type, categoryLabel, subcategoryLabel), 120);
    next.slot = truncate(next.slot, 120);
    next.desc = truncate(next.desc, 1000);

    const healing = parseHealingEffect(next.desc || '');
    if (healing) {
        next.healing = healing;
    } else {
        delete next.healing;
    }

    const slug = buildItemSlug(next.category || next.type || 'item', next.subcategory, next.name);
    if (slug) {
        next.slug = slug;
    } else if (!next.slug) {
        next.slug = buildItemSlug(next.type || 'item', next.subcategory, next.name);
    }

    return next;
}

export function replaceItemInList(items, slug, updated) {
    const list = Array.isArray(items) ? items.map((item) => cloneEntry(item)) : [];
    const index = list.findIndex((item) => item?.slug === slug);
    if (index === -1) {
        return { items: list, updated: null };
    }
    const next = list.slice();
    next[index] = cloneEntry(updated);
    return { items: next, updated: cloneEntry(next[index]) };
}

export async function writeItemEntries(items, { file = DEFAULT_ITEMS_PATH } = {}) {
    if (!Array.isArray(items)) {
        throw new Error('items must be an array');
    }

    const normalized = items.map((item, index) => {
        if (!item || typeof item !== 'object') {
            throw new Error('Invalid item entry in list');
        }
        const copy = updateItemEntry(item, {});
        copy.order = normalizeOrderValue(item.order, index);
        if (!copy.slug) {
            copy.slug = buildItemSlug(copy.category || copy.type || 'item', copy.subcategory, copy.name);
        }
        const effects = normalizeEffectsInput(item.effects || copy.effects);
        if (effects.length > 0) {
            copy.effects = effects;
        } else {
            delete copy.effects;
        }
        return copy;
    });

    await fs.writeFile(file, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    return normalized;
}
