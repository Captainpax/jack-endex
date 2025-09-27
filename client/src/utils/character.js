import {
    ABILITY_KEY_SET,
    DEFAULT_WORLD_SKILLS,
    clampNonNegative,
    normalizeCustomSkills,
} from "../constants/gameData";

/**
 * @typedef {{ key: string, label: string }} WorldSkill
 * @typedef {{ ranks?: number, misc?: number, label?: string, ability?: string }} RawSkillEntry
 * @typedef {{ ranks: number, misc: number }} NormalizedSkill
 * @typedef {{
 *   name: string,
 *   profile: Record<string, any>,
 *   stats: Record<string, any>,
 *   resources: { useTP: boolean, [key: string]: any },
 *   skills: Record<string, NormalizedSkill>,
 *   customSkills: Array<Record<string, any>>,
 * }} NormalizedCharacter
 */

/**
 * Clone any JSON-serializable value, preferring the native structured clone when available.
 * @template T
 * @param {T} value - Value to clone.
 * @returns {T} A deep copy of the provided value.
 */
export function deepClone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

/**
 * Normalize a skill record to include only ranks/misc values while ensuring defaults for world skills.
 * @param {Record<string, RawSkillEntry>} raw - Incoming skills map.
 * @param {WorldSkill[]} worldSkills - Reference list of world skills.
 * @returns {Record<string, NormalizedSkill>} Sanitized skills keyed by skill id.
 */
export function normalizeSkills(raw, worldSkills = DEFAULT_WORLD_SKILLS) {
    const out = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [key, value] of Object.entries(raw)) {
            if (!value || typeof value !== "object" || Array.isArray(value)) continue;
            const ranks = clampNonNegative(value.ranks);
            const miscRaw = Number(value.misc);
            const misc = Number.isFinite(miscRaw) ? miscRaw : 0;
            out[key] = { ranks, misc };
        }
    }
    for (const skill of worldSkills) {
        if (!out[skill.key]) out[skill.key] = { ranks: 0, misc: 0 };
    }
    return out;
}

/**
 * Convert loosely-typed character payloads into the canonical structure expected by the app.
 * Ensures nested objects exist, converts truthy values, and normalizes skill/custom skill collections.
 * @param {any} raw - Arbitrary character data from the API or storage.
 * @param {WorldSkill[]} worldSkills - World skill metadata used for defaults.
 * @returns {NormalizedCharacter} Normalized character object.
 */
export function normalizeCharacter(raw, worldSkills = DEFAULT_WORLD_SKILLS) {
    if (!raw || typeof raw !== "object") {
        return {
            name: "",
            profile: {},
            stats: {},
            resources: { useTP: false },
            skills: normalizeSkills({}, worldSkills),
            customSkills: [],
        };
    }

    const clone = deepClone(raw);
    clone.name = typeof clone.name === "string" ? clone.name : "";
    clone.profile = clone.profile && typeof clone.profile === "object" ? { ...clone.profile } : {};
    clone.stats = clone.stats && typeof clone.stats === "object" ? { ...clone.stats } : {};
    clone.resources = clone.resources && typeof clone.resources === "object" ? { ...clone.resources } : {};

    if (clone.resources.useTP === undefined) {
        clone.resources.useTP = !!clone.resources.tp && !clone.resources.mp;
    } else {
        clone.resources.useTP = !!clone.resources.useTP;
    }

    const skillSource =
        clone.skills && typeof clone.skills === "object" && !Array.isArray(clone.skills)
            ? { ...clone.skills }
            : {};

    const embeddedCustom = [];
    if (Array.isArray(skillSource.customSkills)) embeddedCustom.push(...skillSource.customSkills);
    if (Array.isArray(skillSource._custom)) embeddedCustom.push(...skillSource._custom);
    delete skillSource.customSkills;
    delete skillSource._custom;

    const demoted = [];
    for (const [key, value] of Object.entries(skillSource)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const label = typeof value.label === "string" ? value.label.trim() : "";
        const abilityRaw = typeof value.ability === "string" ? value.ability.trim().toUpperCase() : "";
        if (label && ABILITY_KEY_SET.has(abilityRaw)) {
            demoted.push({
                id: key,
                label,
                ability: abilityRaw,
                ranks: value.ranks,
                misc: value.misc,
            });
            delete skillSource[key];
        }
    }

    clone.skills = normalizeSkills(skillSource, worldSkills);
    const rawCustom = clone.customSkills ?? [...embeddedCustom, ...demoted];
    clone.customSkills = normalizeCustomSkills(rawCustom);

    return clone;
}
