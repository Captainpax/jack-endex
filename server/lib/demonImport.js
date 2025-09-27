import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
export const DEFAULT_DEMONS_PATH = path.join(repoRoot, 'data', 'demons.json');

const ABILITY_KEYS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function normalizeAbilityBlock(source = {}) {
    const block = {};
    for (const key of ABILITY_KEYS) {
        const raw = source?.[key];
        const num = Number(raw);
        block[key] = Number.isFinite(num) ? num : 0;
    }
    return block;
}

function uniqueStrings(values) {
    const set = new Set();
    const output = [];
    for (const value of values) {
        if (!value) continue;
        const trimmed = String(value).trim();
        if (!trimmed) continue;
        const lower = trimmed.toLowerCase();
        if (set.has(lower)) continue;
        set.add(lower);
        output.push(trimmed);
    }
    return output;
}

function buildSearchTerms(entry) {
    const terms = [];
    terms.push(entry.name);
    terms.push(entry.arcana);
    terms.push(entry.alignment);
    terms.push(entry.slug);
    if (Array.isArray(entry.tags)) {
        terms.push(...entry.tags);
    }
    if (Array.isArray(entry.skills)) {
        for (const skill of entry.skills) {
            if (typeof skill === 'string') {
                terms.push(skill);
            } else if (skill?.name) {
                terms.push(skill.name);
            }
        }
    }
    return uniqueStrings(
        terms
            .map((term) => String(term || '').toLowerCase())
            .filter(Boolean),
    );
}

function collectResistanceValues(source, keys) {
    const values = [];
    for (const key of keys) {
        const entry = source?.[key];
        if (!entry && entry !== 0) continue;
        if (Array.isArray(entry)) {
            values.push(...entry);
        } else {
            values.push(entry);
        }
    }
    return uniqueStrings(values);
}

function normalizeResistanceBlock(source = {}) {
    return {
        weak: collectResistanceValues(source, ['weak', 'weaks']),
        resist: collectResistanceValues(source, ['resist', 'resists']),
        block: collectResistanceValues(source, ['block', 'blocks', 'null', 'nullify', 'nullifies']),
        drain: collectResistanceValues(source, ['drain', 'drains', 'absorb', 'absorbs']),
        reflect: collectResistanceValues(source, ['reflect', 'reflects']),
    };
}

function normalizeSkills(skills) {
    if (!Array.isArray(skills)) return [];
    return skills
        .map((skill) => {
            if (typeof skill === 'string') {
                return { name: skill };
            }
            if (!skill || typeof skill !== 'object') return null;
            const name = String(skill.name || '').trim();
            if (!name) return null;
            const cost = skill.cost ?? skill.mp ?? skill.sp ?? null;
            const element = skill.element || skill.type || null;
            const description = skill.description || skill.desc || '';
            return {
                name,
                cost: typeof cost === 'number' ? cost : null,
                element: element ? String(element).trim() : null,
                description: description ? String(description).trim() : '',
            };
        })
        .filter(Boolean);
}

export function convertDemonEntry(raw) {
    const slug = slugify(raw.query || raw.slug || raw.name);
    if (!slug) return null;
    const levelRaw = Number(raw.level);
    const level = Number.isFinite(levelRaw) ? levelRaw : null;
    const stats = normalizeAbilityBlock(raw.stats || raw);
    const mods = normalizeAbilityBlock(raw.mods || {});
    const resistances = normalizeResistanceBlock(raw.resistances || raw);
    const skills = normalizeSkills(raw.skills);
    const tags = uniqueStrings([
        raw.dlc ? `dlc:${raw.dlc}` : null,
        ...(Array.isArray(raw.tags) ? raw.tags : []),
    ]);

    const base = {
        slug,
        name: String(raw.name || slug).trim(),
        arcana: String(raw.arcana || '').trim(),
        alignment: String(raw.alignment || '').trim(),
        level,
        description: String(raw.description || '').trim(),
        image: String(raw.image || '').trim(),
        stats,
        mods,
        resistances,
        skills,
        tags,
        sourceId: Number.isFinite(Number(raw.id)) ? Number(raw.id) : null,
    };

    return {
        ...base,
        searchTerms: buildSearchTerms({ ...base, skills, tags }),
    };
}

export async function loadDemonEntries({ file = DEFAULT_DEMONS_PATH } = {}) {
    const content = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
        throw new Error('Expected data/demons.json to be an array.');
    }
    return parsed.map((entry) => convertDemonEntry(entry)).filter(Boolean);
}
