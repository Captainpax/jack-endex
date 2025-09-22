import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv, envString } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const demonsPath = path.join(repoRoot, 'data', 'demons.json');

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

function normalizeResistanceBlock(source = {}) {
    return {
        weak: uniqueStrings(source.weak || source.weaks || []),
        resist: uniqueStrings(source.resist || source.resists || []),
        null: uniqueStrings(source.null || source.nullify || []),
        absorb: uniqueStrings(source.absorb || source.absorbs || []),
        reflect: uniqueStrings(source.reflect || source.reflects || []),
    };
}

function normalizeSkills(skills) {
    if (!Array.isArray(skills)) return [];
    return skills.map((skill) => {
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
    }).filter(Boolean);
}

function convertEntry(raw) {
    const slug = slugify(raw.query || raw.slug || raw.name);
    if (!slug) return null;
    const levelRaw = Number(raw.level);
    const level = Number.isFinite(levelRaw) ? levelRaw : null;
    return {
        slug,
        name: String(raw.name || slug).trim(),
        arcana: String(raw.arcana || '').trim(),
        alignment: String(raw.alignment || '').trim(),
        level,
        description: String(raw.description || '').trim(),
        image: String(raw.image || '').trim(),
        stats: normalizeAbilityBlock(raw.stats || raw),
        mods: normalizeAbilityBlock(raw.mods || {}),
        resistances: normalizeResistanceBlock(raw.resistances || raw),
        skills: normalizeSkills(raw.skills),
        tags: uniqueStrings([raw.dlc ? `dlc:${raw.dlc}` : null, ...(Array.isArray(raw.tags) ? raw.tags : [])]),
        searchTerms: buildSearchTerms(raw),
        sourceId: Number.isFinite(Number(raw.id)) ? Number(raw.id) : null,
    };
}

async function readSource(file = demonsPath) {
    const content = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
        throw new Error('Expected data/demons.json to be an array.');
    }
    const converted = parsed
        .map((entry) => convertEntry(entry))
        .filter(Boolean);
    return converted;
}

export async function importDemons({ file = demonsPath, dryRun = false, dropMissing = true } = {}) {
    await loadEnv({ root: repoRoot });
    const entries = await readSource(file);
    if (dryRun) {
        console.log(`[dry-run] Prepared ${entries.length} demons for import.`);
        const sample = entries.slice(0, 3).map((entry) => ({ slug: entry.slug, name: entry.name, level: entry.level }));
        console.log('[dry-run] Sample:', sample);
        return { count: entries.length, entries: sample };
    }

    const mongooseModule = await import('../lib/mongoose.js');
    const mongoose = mongooseModule.default ?? mongooseModule;
    const DemonModule = await import('../models/Demon.js');
    const Demon = DemonModule.default ?? DemonModule;

    const uri = envString('MONGODB_URI');
    const dbName = envString('MONGODB_DB_NAME');
    if (!uri) {
        throw new Error('MONGODB_URI is not configured.');
    }

    await mongoose.connect(uri, { dbName: dbName || undefined });

    const bulkOps = entries.map((entry) => ({
        replaceOne: {
            filter: { slug: entry.slug },
            replacement: entry,
            upsert: true,
        },
    }));

    if (bulkOps.length > 0) {
        await Demon.bulkWrite(bulkOps, { ordered: false });
    }

    if (dropMissing) {
        const slugs = entries.map((entry) => entry.slug);
        await Demon.deleteMany({ slug: { $nin: slugs } });
    }

    await mongoose.disconnect();
    console.log(`Imported ${entries.length} demons into MongoDB.`);
    return { count: entries.length };
}

if (import.meta.url === process.argv[1] || import.meta.url === `file://${process.argv[1]}`) {
    const args = new Set(process.argv.slice(2));
    const dryRun = args.has('--dry-run');
    const keep = args.has('--keep-missing');
    importDemons({ dryRun, dropMissing: !keep })
        .catch((err) => {
            console.error('Failed to import demons:', err);
            process.exit(1);
        });
}
