#!/usr/bin/env node
/* eslint-env node */
import fs from 'fs/promises';
import path from 'path';
import process from 'node:process';
import { fileURLToPath } from 'url';

const ABILITY_KEYS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

function abilityModifier(score) {
    const num = Number(score);
    if (!Number.isFinite(num)) return 0;
    return Math.floor((num - 10) / 2);
}

function normalizeAbilityScores(raw = {}) {
    const out = {};
    for (const key of ABILITY_KEYS) {
        const value = raw?.[key];
        const num = Number(value);
        out[key] = Number.isFinite(num) ? num : 0;
    }
    return out;
}

function convertLegacyStats(raw) {
    if (!raw || typeof raw !== 'object') {
        return normalizeAbilityScores();
    }
    const hasModern = ABILITY_KEYS.some((key) => Object.prototype.hasOwnProperty.call(raw, key));
    if (hasModern) {
        return normalizeAbilityScores(raw);
    }
    const mapped = {
        STR: raw.STR ?? raw.strength,
        DEX: raw.DEX ?? raw.agility,
        CON: raw.CON ?? raw.endurance,
        INT: raw.INT ?? raw.magic,
        CHA: raw.CHA ?? raw.luck,
    };
    const legacyWis =
        raw.WIS ??
        raw.wisdom ??
        Math.round(((Number(raw.magic) || 0) + (Number(raw.luck) || 0)) / 2);
    mapped.WIS = legacyWis;
    return normalizeAbilityScores(mapped);
}

function deriveMods(stats) {
    const mods = {};
    for (const key of ABILITY_KEYS) {
        mods[key] = abilityModifier(stats[key]);
    }
    return mods;
}

function normalizeList(value) {
    if (!value && value !== 0) return [];
    if (Array.isArray(value)) {
        return value
            .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry)))
            .filter((entry) => entry.length > 0);
    }
    if (typeof value === 'string') {
        return value
            .split(/[\n,]/)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
    }
    return [String(value).trim()].filter((entry) => entry.length > 0);
}

function normalizeResistanceBlock(raw, fallback = {}) {
    const weak = normalizeList(raw?.weak ?? fallback.weak);
    const resist = normalizeList(raw?.resist ?? raw?.resists ?? fallback.resist ?? fallback.resists);
    const nulls = normalizeList(raw?.null ?? raw?.nullifies ?? fallback.null ?? fallback.nullifies);
    const absorb = normalizeList(raw?.absorb ?? raw?.absorbs ?? fallback.absorb ?? fallback.absorbs);
    const reflect = normalizeList(raw?.reflect ?? raw?.reflects ?? fallback.reflect ?? fallback.reflects);
    return { weak, resist, null: nulls, absorb, reflect };
}

function normalizeSkills(raw) {
    if (!raw && raw !== 0) return [];
    if (Array.isArray(raw)) {
        return raw
            .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry)))
            .filter((entry) => entry.length > 0);
    }
    if (typeof raw === 'string') {
        return raw
            .split(/[\n,]/)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
    }
    return [String(raw).trim()].filter((entry) => entry.length > 0);
}

function convertDemon(demon = {}) {
    const stats = convertLegacyStats(demon.stats ?? demon);
    const mods = deriveMods(stats);

    const resistances = normalizeResistanceBlock(demon.resistances, demon);
    const normalizedSkills = normalizeSkills(demon.skills);

    const base = { ...demon };
    delete base.strength;
    delete base.agility;
    delete base.endurance;
    delete base.magic;
    delete base.luck;
    delete base.weak;
    delete base.resists;
    delete base.reflects;
    delete base.absorbs;
    delete base.nullifies;
    delete base.stats;
    delete base.mods;
    delete base.resistances;
    delete base.skills;

    return {
        ...base,
        stats,
        mods,
        resistances,
        skills: normalizedSkills,
    };
}

async function main() {
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(dirname, '..');
    const sourcePath = path.join(repoRoot, 'data', 'demons.json');

    const raw = await fs.readFile(sourcePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
        throw new Error('data/demons.json is not an array');
    }

    const converted = parsed.map((entry) => convertDemon(entry));
    const formatted = `${JSON.stringify(converted, null, 2)}\n`;
    await fs.writeFile(sourcePath, formatted, 'utf8');
    console.log(`Converted ${converted.length} demons to ability-based schema.`);
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
