import { EMPTY_ARRAY } from "../utils/constants";
import {
    DEFAULT_WORLD_SKILL_DEFS,
    DEFAULT_WORLD_SKILLS as SHARED_WORLD_SKILLS,
} from "@shared/worldSkills.js";

export const ABILITY_DEFS = [
    {
        key: "STR",
        label: "Strength",
        summary: "HP+, melee strikes, physical prowess",
    },
    {
        key: "DEX",
        label: "Dexterity",
        summary: "TP++, guns, reflexes, acting first",
    },
    {
        key: "CON",
        label: "Constitution",
        summary: "HP++, TP+, grit against ailments",
    },
    {
        key: "INT",
        label: "Intelligence",
        summary: "MP++, SP++, offensive spellcraft",
    },
    {
        key: "WIS",
        label: "Wisdom",
        summary: "MP+, restorative and support focus",
    },
    {
        key: "CHA",
        label: "Charisma",
        summary: "SP+, negotiations, social leverage",
    },
];

export const ABILITY_SORT_INDEX = ABILITY_DEFS.reduce((map, ability, index) => {
    map[ability.key] = index;
    return map;
}, {});

export const RESISTANCE_FIELDS = [
    { key: "weak", label: "Weak", aliases: ["weak", "weaks"] },
    { key: "resist", label: "Resist", aliases: ["resist", "resists"] },
    { key: "block", label: "Block", aliases: ["block", "blocks", "null", "nullify", "nullifies"] },
    { key: "drain", label: "Drain", aliases: ["drain", "drains", "absorb", "absorbs"] },
    { key: "reflect", label: "Reflect", aliases: ["reflect", "reflects"] },
];

export const RESISTANCE_ALIAS_MAP = RESISTANCE_FIELDS.reduce((map, field) => {
    map[field.key] = Array.isArray(field.aliases) && field.aliases.length > 0
        ? field.aliases
        : [field.key];
    return map;
}, {});

export const DEMON_RESISTANCE_SORTS = [
    { key: "weak", label: "Weakness slots (fewest → most)", direction: "asc" },
    { key: "resist", label: "Resistances (most → fewest)", direction: "desc" },
    { key: "block", label: "Blocks (most → fewest)", direction: "desc" },
    { key: "drain", label: "Drains (most → fewest)", direction: "desc" },
    { key: "reflect", label: "Reflections (most → fewest)", direction: "desc" },
];

export const DEMON_SORT_OPTIONS = [
    { value: "name", label: "Name (A → Z)" },
    { value: "arcana", label: "Arcana (A → Z)" },
    { value: "levelHigh", label: "Level (high → low)" },
    { value: "levelLow", label: "Level (low → high)" },
    ...ABILITY_DEFS.map((ability) => ({
        value: `stat:${ability.key}`,
        label: `${ability.label} (high → low)`,
    })),
    ...DEMON_RESISTANCE_SORTS.map((entry) => ({
        value: `resist:${entry.key}`,
        label: entry.label,
    })),
    { value: "skillCount", label: "Skills (most → fewest)" },
];

export const COMBAT_TIER_ORDER = ["WEAK", "MEDIUM", "HEAVY", "SEVERE"];
export const COMBAT_TIER_INDEX = COMBAT_TIER_ORDER.reduce((map, tier, index) => {
    map[tier] = index;
    return map;
}, {});
export const COMBAT_TIER_LABELS = {
    WEAK: "Weak",
    MEDIUM: "Medium",
    HEAVY: "Heavy",
    SEVERE: "Severe",
};
export const COMBAT_TIER_INFO = {
    WEAK: { label: "Weak", dice: "1d6", modMultiplier: 1 },
    MEDIUM: { label: "Medium", dice: "2d8", modMultiplier: 2 },
    HEAVY: { label: "Heavy", dice: "3d12", modMultiplier: 3 },
    SEVERE: { label: "Severe", dice: "4d20", modMultiplier: 4 },
};

export const COMBAT_CATEGORY_OPTIONS = [
    { value: "physical", label: "Physical" },
    { value: "gun", label: "Gun" },
    { value: "spell", label: "Spell" },
    { value: "support", label: "Support" },
    { value: "hybrid", label: "Hybrid / Other" },
];
export const COMBAT_CATEGORY_ALIASES = {
    physical: "physical",
    phys: "physical",
    melee: "physical",
    gun: "gun",
    ranged: "gun",
    shoot: "gun",
    spell: "spell",
    magic: "spell",
    caster: "spell",
    support: "support",
    buff: "support",
    heal: "support",
    hybrid: "hybrid",
    other: "hybrid",
    tech: "hybrid",
};
export const COMBAT_CATEGORY_INDEX = COMBAT_CATEGORY_OPTIONS.reduce((map, option, index) => {
    map[option.value] = index;
    return map;
}, {});
export const COMBAT_CATEGORY_LABELS = COMBAT_CATEGORY_OPTIONS.reduce((map, option) => {
    map[option.value] = option.label;
    return map;
}, {});
export const DEFAULT_COMBAT_CATEGORY = COMBAT_CATEGORY_OPTIONS[0]?.value || "physical";

export const NEW_COMBAT_SKILL_ID = "__new_combat_skill__";

export function compareByNameAsc(a, b) {
    return a.label.localeCompare(b.label);
}

export function compareByNameDesc(a, b) {
    return b.label.localeCompare(a.label);
}

export function compareByAbilityAsc(a, b) {
    const aIndex = ABILITY_SORT_INDEX[a.ability] ?? 999;
    const bIndex = ABILITY_SORT_INDEX[b.ability] ?? 999;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return compareByNameAsc(a, b);
}

export function compareByAbilityDesc(a, b) {
    const aIndex = ABILITY_SORT_INDEX[a.ability] ?? -1;
    const bIndex = ABILITY_SORT_INDEX[b.ability] ?? -1;
    if (aIndex !== bIndex) return bIndex - aIndex;
    return compareByNameDesc(a, b);
}

export function compareByTierAsc(a, b) {
    const aIndex = COMBAT_TIER_INDEX[a.tier] ?? 0;
    const bIndex = COMBAT_TIER_INDEX[b.tier] ?? 0;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return compareByNameAsc(a, b);
}

export function compareByTierDesc(a, b) {
    const aIndex = COMBAT_TIER_INDEX[a.tier] ?? 0;
    const bIndex = COMBAT_TIER_INDEX[b.tier] ?? 0;
    if (aIndex !== bIndex) return bIndex - aIndex;
    return compareByNameAsc(a, b);
}

export function compareByCategoryAsc(a, b) {
    const aIndex = COMBAT_CATEGORY_INDEX[a.category] ?? 999;
    const bIndex = COMBAT_CATEGORY_INDEX[b.category] ?? 999;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return compareByNameAsc(a, b);
}

export function compareByCategoryDesc(a, b) {
    const aIndex = COMBAT_CATEGORY_INDEX[a.category] ?? -1;
    const bIndex = COMBAT_CATEGORY_INDEX[b.category] ?? -1;
    if (aIndex !== bIndex) return bIndex - aIndex;
    return compareByNameAsc(a, b);
}

export const WORLD_SKILL_SORT_OPTIONS = [
    { value: "default", label: "Default order" },
    { value: "nameAsc", label: "Name (A → Z)" },
    { value: "nameDesc", label: "Name (Z → A)" },
    { value: "abilityAsc", label: "Ability (STR → CHA)" },
    { value: "abilityDesc", label: "Ability (CHA → STR)" },
];

export const WORLD_SKILL_SORTERS = {
    default: null,
    nameAsc: compareByNameAsc,
    nameDesc: compareByNameDesc,
    abilityAsc: compareByAbilityAsc,
    abilityDesc: compareByAbilityDesc,
};

export const COMBAT_SKILL_SORT_OPTIONS = [
    { value: "default", label: "Default order" },
    { value: "nameAsc", label: "Name (A → Z)" },
    { value: "nameDesc", label: "Name (Z → A)" },
    { value: "tierAsc", label: "Tier (Weak → Severe)" },
    { value: "tierDesc", label: "Tier (Severe → Weak)" },
    { value: "abilityAsc", label: "Ability (STR → CHA)" },
    { value: "abilityDesc", label: "Ability (CHA → STR)" },
    { value: "categoryAsc", label: "Category A → Z" },
    { value: "categoryDesc", label: "Category Z → A" },
];

export const COMBAT_SKILL_SORTERS = {
    default: null,
    nameAsc: compareByNameAsc,
    nameDesc: compareByNameDesc,
    abilityAsc: compareByAbilityAsc,
    abilityDesc: compareByAbilityDesc,
    tierAsc: compareByTierAsc,
    tierDesc: compareByTierDesc,
    categoryAsc: compareByCategoryAsc,
    categoryDesc: compareByCategoryDesc,
};

export const ARCANA_DATA = [
    { key: "fool", label: "Fool", bonus: "+1 SP on level", penalty: "No bonus stats on creation" },
    { key: "magician", label: "Magician", bonus: "+2 INT", penalty: "-2 STR" },
    { key: "emperor", label: "Emperor", bonus: "+1 CHA, +1 STR", penalty: "-2 DEX" },
    { key: "empress", label: "Empress", bonus: "+1 CHA, +1 DEX", penalty: "-2 STR" },
    { key: "chariot", label: "Chariot", bonus: "+2 CON", penalty: "-1 DEX, -1 WIS" },
    { key: "hermit", label: "Hermit", bonus: "+2 WIS", penalty: "-2 CON" },
    { key: "fortune", label: "Fortune", bonus: "+1 CHA, +1 DEX", penalty: "-2 WIS" },
    { key: "strength", label: "Strength", bonus: "+2 STR", penalty: "-2 INT" },
    { key: "temperance", label: "Temperance", bonus: "+2 CHA", penalty: "-1 INT, -1 WIS" },
    { key: "tower", label: "Tower", bonus: "+2 WIS", penalty: "-1 STR, -1 DEX" },
    { key: "star", label: "Star", bonus: "+2 DEX", penalty: "-1 INT, -1 CHA" },
    { key: "moon", label: "Moon", bonus: "+1 STR, +1 WIS", penalty: "-2 DEX" },
    { key: "sun", label: "Sun", bonus: "+2 INT", penalty: "-2 WIS" },
    { key: "knight", label: "Knight", bonus: "+1 DEX, +1 STR", penalty: "-1 CHA, -1 CON" },
];

export const CONCEPT_PROMPTS = Object.freeze([
    {
        key: "reluctant-binder",
        title: "Reluctant Binder",
        hook: "You made a desperate pact with a demon to save someone dear to you.",
        question: "What clause still keeps you awake at night?",
    },
    {
        key: "wandering-scholar",
        title: "Wandering Scholar",
        hook: "Your research into forgotten Arcana drew the attention of rival cults.",
        question: "Which taboo discovery are you hiding from the party?",
    },
    {
        key: "fallen-prodigy",
        title: "Fallen Prodigy",
        hook: "Once a celebrated exorcist, you vanished after a mission went wrong.",
        question: "Who from your old order is still hunting you down?",
    },
    {
        key: "masked-mediator",
        title: "Masked Mediator",
        hook: "You broker truces between mortals and demons in neutral ground night markets.",
        question: "What price will you demand for the party's first favour?",
    },
]);

export const DEFAULT_WORLD_SKILLS = SHARED_WORLD_SKILLS;
export { DEFAULT_WORLD_SKILL_DEFS };

export const ABILITY_KEY_SET = new Set(ABILITY_DEFS.map((ability) => ability.key));
export const NEW_WORLD_SKILL_ID = "__new_world_skill__";

export function makeCustomSkillId(label, existing = new Set()) {
    const base = String(label || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    const fallback = base ? `custom-${base}` : `custom-${Math.random().toString(36).slice(2, 8)}`;
    let id = fallback;
    let attempt = 1;
    while (existing.has(id)) {
        attempt += 1;
        id = `${fallback}-${attempt}`;
    }
    existing.add(id);
    return id;
}

export function normalizeCustomSkills(raw) {
    const source = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    const normalized = [];
    for (const entry of source) {
        if (!entry || typeof entry !== 'object') continue;
        const label = typeof entry.label === 'string' ? entry.label.trim() : '';
        if (!label) continue;
        const abilityRaw = typeof entry.ability === 'string' ? entry.ability.trim().toUpperCase() : '';
        const ability = ABILITY_KEY_SET.has(abilityRaw) ? abilityRaw : 'INT';
        const ranks = clampNonNegative(entry.ranks);
        const miscRaw = Number(entry.misc);
        const misc = Number.isFinite(miscRaw) ? miscRaw : 0;
        let id = typeof entry.id === 'string' ? entry.id.trim() : '';
        if (!id || seen.has(id)) {
            id = makeCustomSkillId(label, seen);
        } else {
            seen.add(id);
        }
        normalized.push({ id, label, ability, ranks, misc });
    }
    return normalized;
}

export function serializeSkills(map) {
    const out = {};
    if (!map || typeof map !== 'object') return out;
    for (const [key, value] of Object.entries(map)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const ranks = clampNonNegative(value.ranks);
        const miscRaw = Number(value.misc);
        const misc = Number.isFinite(miscRaw) ? miscRaw : 0;
        out[key] = { ranks, misc };
    }
    return out;
}

export function serializeCustomSkills(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const normalized = [];
    for (const entry of list) {
        if (!entry || typeof entry !== 'object') continue;
        const label = typeof entry.label === 'string' ? entry.label.trim() : '';
        if (!label) continue;
        const abilityRaw = typeof entry.ability === 'string' ? entry.ability.trim().toUpperCase() : '';
        const ability = ABILITY_KEY_SET.has(abilityRaw) ? abilityRaw : 'INT';
        const ranks = clampNonNegative(entry.ranks);
        const miscRaw = Number(entry.misc);
        const misc = Number.isFinite(miscRaw) ? miscRaw : 0;
        let id = typeof entry.id === 'string' ? entry.id.trim() : '';
        if (!id || seen.has(id)) {
            id = makeCustomSkillId(label, seen);
        } else {
            seen.add(id);
        }
        normalized.push({ id, label, ability, ranks, misc });
    }
    return normalized;
}

export function createAbilityMap(initial = 0) {
    return ABILITY_DEFS.reduce((acc, ability) => {
        acc[ability.key] = initial;
        return acc;
    }, {});
}

export function normalizeAbilityState(source) {
    const map = createAbilityMap(0);
    for (const ability of ABILITY_DEFS) {
        const raw = source?.[ability.key];
        const num = Number(raw);
        map[ability.key] = Number.isFinite(num) ? num : 0;
    }
    return map;
}

export function resolveAbilityState(source) {
    if (!source || typeof source !== 'object') {
        return createAbilityMap(0);
    }
    const hasModernKeys = ABILITY_DEFS.every((ability) => source[ability.key] !== undefined);
    if (hasModernKeys) {
        return normalizeAbilityState(source);
    }
    const legacy = {
        STR: source.STR ?? source.strength,
        DEX: source.DEX ?? source.agility,
        CON: source.CON ?? source.endurance,
        INT: source.INT ?? source.magic,
        CHA: source.CHA ?? source.luck,
    };
    const wisGuess =
        source.WIS ??
        source.wisdom ??
        Math.round(((Number(source.magic) || 0) + (Number(source.luck) || 0)) / 2);
    legacy.WIS = wisGuess;
    return normalizeAbilityState(legacy);
}

export function formatResistanceList(primary, fallback) {
    const source = primary ?? fallback;
    if (Array.isArray(source)) {
        return source.length > 0 ? source.join(', ') : '—';
    }
    if (typeof source === 'string' && source.trim()) {
        return source;
    }
    return '—';
}

export function normalizeStringList(value) {
    if (!value && value !== 0) return EMPTY_ARRAY;
    if (Array.isArray(value)) {
        return value
            .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry ?? '')))
            .filter((entry) => entry.length > 0);
    }
    if (typeof value === 'string') {
        return value
            .split(/[\n,]/)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
    }
    const text = String(value ?? '').trim();
    return text ? [text] : EMPTY_ARRAY;
}

export function getResistanceValues(demon, key) {
    if (!demon) return EMPTY_ARRAY;
    const aliases = RESISTANCE_ALIAS_MAP[key] || [key];
    const values = new Set();
    for (const alias of aliases) {
        for (const entry of normalizeStringList(demon.resistances?.[alias])) {
            values.add(entry);
        }
    }
    for (const alias of aliases) {
        for (const entry of normalizeStringList(demon[alias])) {
            values.add(entry);
        }
    }
    return Array.from(values);
}

export function collectResistanceTerms(demon) {
    if (!demon) return EMPTY_ARRAY;
    const values = [];
    for (const field of RESISTANCE_FIELDS) {
        for (const entry of getResistanceValues(demon, field.key)) {
            values.push(entry.toLowerCase());
        }
    }
    return values;
}

export function getResistanceCount(demon, key) {
    return getResistanceValues(demon, key).length;
}

export function getDemonSkillList(demon) {
    if (!demon) return EMPTY_ARRAY;
    if (Array.isArray(demon.skills)) {
        return demon.skills
            .map((entry) => {
                if (typeof entry === 'string') return entry.trim();
                if (entry && typeof entry === 'object') {
                    if (typeof entry.name === 'string') return entry.name.trim();
                    if (typeof entry.label === 'string') return entry.label.trim();
                }
                return '';
            })
            .filter((entry) => entry.length > 0);
    }
    if (typeof demon.skills === 'string') {
        return demon.skills
            .split(/[\n,]/)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
    }
    return EMPTY_ARRAY;
}

export function makeWorldSkillId(label, seen) {
    const base = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const fallback = base || `skill-${Math.random().toString(36).slice(2, 8)}`;
    let id = fallback;
    let attempt = 1;
    while (seen.has(id)) {
        attempt += 1;
        id = `${fallback}-${attempt}`;
    }
    return id;
}

export function makeCombatSkillId(label, seen) {
    const base = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const fallback = base || `combat-${Math.random().toString(36).slice(2, 8)}`;
    let id = fallback;
    let attempt = 1;
    while (seen.has(id)) {
        attempt += 1;
        id = `${fallback}-${attempt}`;
    }
    seen.add(id);
    return id;
}

export function normalizeCombatCategoryValue(raw) {
    if (typeof raw === "string" && raw.trim()) {
        const key = raw.trim().toLowerCase();
        if (COMBAT_CATEGORY_ALIASES[key]) {
            return COMBAT_CATEGORY_ALIASES[key];
        }
        if (Object.prototype.hasOwnProperty.call(COMBAT_CATEGORY_INDEX, key)) {
            return key;
        }
    }
    return DEFAULT_COMBAT_CATEGORY;
}

export function normalizeWorldSkillDefs(raw) {
    const allowEmpty = Array.isArray(raw);
    const source = allowEmpty ? raw : DEFAULT_WORLD_SKILLS;
    const seen = new Set();
    const normalized = [];
    for (const entry of source || []) {
        if (!entry || typeof entry !== "object") continue;
        const labelValue =
            typeof entry.label === "string"
                ? entry.label.trim()
                : typeof entry.name === "string"
                ? entry.name.trim()
                : "";
        if (!labelValue) continue;
        const abilityRaw =
            typeof entry.ability === "string" ? entry.ability.trim().toUpperCase() : "";
        const ability = ABILITY_KEY_SET.has(abilityRaw) ? abilityRaw : "INT";
        let id = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : null;
        if (!id && typeof entry.key === "string" && entry.key.trim()) id = entry.key.trim();
        if (!id) id = makeWorldSkillId(labelValue, seen);
        if (seen.has(id)) {
            id = makeWorldSkillId(`${labelValue}-${Math.random().toString(36).slice(2, 4)}`, seen);
        }
        seen.add(id);
        normalized.push({ id, key: id, label: labelValue, ability });
    }
    if (normalized.length === 0 && !allowEmpty) {
        return DEFAULT_WORLD_SKILLS.map((skill) => ({
            id: skill.key,
            key: skill.key,
            label: skill.label,
            ability: ABILITY_KEY_SET.has(skill.ability) ? skill.ability : "INT",
        }));
    }
    return normalized;
}

export function normalizeCombatSkillDefs(raw) {
    const source = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    const normalized = [];
    for (const entry of source) {
        if (!entry || typeof entry !== "object") continue;
        const labelValue =
            typeof entry.label === "string"
                ? entry.label.trim()
                : typeof entry.name === "string"
                ? entry.name.trim()
                : "";
        if (!labelValue) continue;
        let id = typeof entry.id === "string" ? entry.id.trim() : "";
        if (!id && typeof entry.key === "string") id = entry.key.trim();
        if (!id || seen.has(id)) {
            id = makeCombatSkillId(labelValue, seen);
        } else {
            seen.add(id);
        }
        const abilityRaw = typeof entry.ability === "string" ? entry.ability.trim().toUpperCase() : "";
        const ability = ABILITY_KEY_SET.has(abilityRaw) ? abilityRaw : ABILITY_DEFS[0]?.key || "INT";
        const tierRaw = typeof entry.tier === "string" ? entry.tier.trim().toUpperCase() : "";
        const tier = COMBAT_TIER_ORDER.includes(tierRaw) ? tierRaw : COMBAT_TIER_ORDER[0];
        const categoryValue =
            typeof entry.category === "string"
                ? entry.category
                : typeof entry.type === "string"
                ? entry.type
                : DEFAULT_COMBAT_CATEGORY;
        const category = normalizeCombatCategoryValue(categoryValue);
        const cost = typeof entry.cost === "string" ? entry.cost.trim() : typeof entry.resource === "string" ? entry.resource.trim() : "";
        const notes =
            typeof entry.notes === "string"
                ? entry.notes.trim()
                : typeof entry.description === "string"
                ? entry.description.trim()
                : "";
        normalized.push({ id, key: id, label: labelValue, ability, tier, category, cost, notes });
    }
    return normalized;
}

export function computeCombatSkillDamage({ tier, abilityMod, roll, bonus = 0, buff = 1, critical = false }) {
    const info = COMBAT_TIER_INFO[tier] || COMBAT_TIER_INFO.WEAK;
    const rollValue = Number(roll);
    const abilityValue = Number(abilityMod);
    const bonusValue = Number(bonus);
    let buffValue = Number(buff);
    if (!Number.isFinite(rollValue) || !Number.isFinite(abilityValue) || !Number.isFinite(bonusValue)) {
        return null;
    }
    if (!Number.isFinite(buffValue) || buffValue <= 0) {
        buffValue = 1;
    }
    const abilityContribution = abilityValue * info.modMultiplier;
    const base = rollValue + abilityContribution + bonusValue;
    const critMultiplier = critical ? 1.75 : 1;
    const preBuff = base * critMultiplier;
    const total = Math.ceil(preBuff * buffValue);
    return {
        total,
        baseRoll: rollValue,
        abilityContribution,
        bonus: bonusValue,
        critMultiplier,
        buffMultiplier: buffValue,
        preBuff,
    };
}

export const SAVE_DEFS = [
    { key: "fortitude", label: "Fortitude", ability: "CON" },
    { key: "reflex", label: "Reflex", ability: "DEX" },
    { key: "will", label: "Will", ability: "WIS" },
];

export const ROLE_ARCHETYPES = [
    {
        key: "tank",
        title: "Tank",
        stats: "CON+++ · STR++ · DEX+",
        pros: "Tough as nails, absorbs punishment",
        cons: "Slow and often simple-minded",
    },
    {
        key: "fighter",
        title: "Fighter",
        stats: "STR+++ · DEX++ · CON+",
        pros: "Versatile weapon expert",
        cons: "Needs support versus magic",
    },
    {
        key: "gunner",
        title: "Gunner",
        stats: "DEX+++ · STR++ · CON+",
        pros: "Dominates from range",
        cons: "Fragile up close",
    },
    {
        key: "mage",
        title: "Mage",
        stats: "INT+++ · WIS++ · CHA+",
        pros: "Devastating spells & AoEs",
        cons: "Low physical defenses",
    },
    {
        key: "healer",
        title: "Healer",
        stats: "WIS+++ · INT++ · CHA+",
        pros: "Sustain & buffs",
        cons: "Lower personal damage",
    },
    {
        key: "negotiator",
        title: "Negotiator",
        stats: "CHA+++ · WIS++ · INT+",
        pros: "Best at demon diplomacy",
        cons: "Weak alone if cornered",
    },
];

export function abilityModifier(score) {
    const value = Number(score);
    if (!Number.isFinite(value)) return 0;
    return Math.floor((value - 10) / 2);
}

export function formatModifier(mod) {
    const value = Number(mod) || 0;
    return value >= 0 ? `+${value}` : String(value);
}

export function clampNonNegative(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return 0;
    return num;
}

// ---------- App Root ----------
