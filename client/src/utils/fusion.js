import { ARCANA_DATA } from "../constants/gameData";
import {
    FUSE_ARCANA_KEY_BY_LABEL,
    FUSE_ARCANA_LABEL_BY_KEY,
    FUSE_ARCANA_ORDER,
    FUSE_CHART,
    FUSION_ARCANA_METADATA,
} from "../constants/fusionChart";

/**
 * @typedef {{ key: string, label: string }} ArcanaOption
 * @typedef {{
 *   value: string,
 *   label: string,
 * }} MoonPhaseOption
 * @typedef {{
 *   value: number,
 *   sides: number,
 *   isCriticalHigh: boolean,
 *   isCriticalLow: boolean,
 * }} FusionRoll
 * @typedef {{
 *   type: "ceil" | "floor",
 *   shift: number,
 *   label: string,
 * }} FusionRounding
 * @typedef {{
 *   pairKey: string,
 *   arcanaA: string,
 *   arcanaB: string,
 *   baseSeed: string,
 *   moonPhase: string,
 *   roll: FusionRoll | null,
 *   notifications: string[],
 *   arcanaSource: "chart" | "random",
 *   arcanaCandidates: string[],
 *   baseArcana: string | null,
 *   rounding: FusionRounding,
 * }} FusionPlan
 * @typedef {{
 *   arcanaKey: string,
 *   arcanaLabel: string,
 *   demon: any,
 *   averageLevel: number | null,
 *   rounding: FusionRounding,
 *   targetLevel: number | null,
 *   tieCount: number,
 *   selectedIndex: number,
 * }} FusionResult
 */

const BASE_ARCANA_KEYS = ARCANA_DATA.map((entry) => entry.key);
const EXTRA_ARCANA_KEYS = FUSE_ARCANA_ORDER.filter((key) => !BASE_ARCANA_KEYS.includes(key));
const ARCANA_KEYS = [...BASE_ARCANA_KEYS, ...EXTRA_ARCANA_KEYS];

const ARCANA_LABEL_BY_KEY = new Map([
    ...ARCANA_DATA.map((entry) => [entry.key, entry.label]),
    ...FUSION_ARCANA_METADATA.map((entry) => [entry.key, entry.label]),
]);

const ARCANA_KEY_BY_LABEL = new Map([
    ...ARCANA_DATA.map((entry) => [entry.label.toLowerCase(), entry.key]),
    ...FUSION_ARCANA_METADATA.map((entry) => [entry.label.toLowerCase(), entry.key]),
]);

for (const [alias, key] of FUSE_ARCANA_KEY_BY_LABEL.entries()) {
    if (!ARCANA_KEY_BY_LABEL.has(alias)) {
        ARCANA_KEY_BY_LABEL.set(alias, key);
    }
}

const FUSION_RULE_OVERRIDES = new Map();

/**
 * Create a deterministic key for a pair of identifiers regardless of order.
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function buildPairKey(a, b) {
    const list = [a, b].map((value) => value || "").sort();
    return list.join("+");
}

/**
 * Resolve a demon identifier suitable for seeding RNG calculations.
 * Falls back to commonly available fields such as id/slug/name.
 * @param {any} demon
 * @returns {string}
 */
function resolveFusionIdentifier(demon) {
    if (!demon || typeof demon !== "object") return "";
    const candidates = ["id", "slug", "query", "name"];
    for (const key of candidates) {
        const value = typeof demon[key] === "string" ? demon[key].trim() : "";
        if (value) return value.toLowerCase();
    }
    return "";
}

/**
 * Normalize user-provided arcana strings into canonical keys used by the fusion chart.
 * @param {string} value
 * @returns {string}
 */
export function normalizeArcanaKey(value) {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";
    const lower = trimmed.toLowerCase();
    if (ARCANA_KEY_BY_LABEL.has(lower)) {
        return ARCANA_KEY_BY_LABEL.get(lower) || "";
    }
    if (ARCANA_KEYS.includes(lower)) {
        return lower;
    }
    if (FUSE_ARCANA_KEY_BY_LABEL.has(lower)) {
        return FUSE_ARCANA_KEY_BY_LABEL.get(lower) || "";
    }
    return "";
}

/**
 * Look up a human-friendly label for an arcana key.
 * @param {string} key
 * @returns {string}
 */
export function getArcanaLabel(key) {
    const normalized = normalizeArcanaKey(key);
    if (!normalized) return "";
    if (ARCANA_LABEL_BY_KEY.has(normalized)) {
        return ARCANA_LABEL_BY_KEY.get(normalized) || "";
    }
    if (FUSE_ARCANA_LABEL_BY_KEY.has(normalized)) {
        return FUSE_ARCANA_LABEL_BY_KEY.get(normalized) || "";
    }
    return normalized;
}

/**
 * List base arcana options suitable for populating select inputs.
 * @returns {ArcanaOption[]}
 */
export function listArcanaOptions() {
    return ARCANA_DATA.map((entry) => ({ key: entry.key, label: entry.label }));
}

/**
 * List bonus arcana options only available through fusion rules.
 * @returns {ArcanaOption[]}
 */
export function listFusionArcanaOptions() {
    return FUSION_ARCANA_METADATA.map((entry) => ({ key: entry.key, label: entry.label }));
}

/**
 * Lookup the resulting arcana from the fusion chart for a pair of inputs.
 * @param {string} arcanaA
 * @param {string} arcanaB
 * @returns {string | null}
 */
export function resolveChartArcana(arcanaA, arcanaB) {
    const keyA = normalizeArcanaKey(arcanaA);
    const keyB = normalizeArcanaKey(arcanaB);
    if (!keyA || !keyB) return null;
    const direct = FUSE_CHART[keyA]?.[keyB];
    if (direct) return direct;
    const mirrored = FUSE_CHART[keyB]?.[keyA];
    if (mirrored) return mirrored;
    return null;
}

/**
 * Suggest an arcana for fusion, honoring overrides and randomization rules.
 * @param {string} arcanaA
 * @param {string} arcanaB
 * @returns {string | null}
 */
export function suggestFusionArcana(arcanaA, arcanaB) {
    const keyA = normalizeArcanaKey(arcanaA);
    const keyB = normalizeArcanaKey(arcanaB);
    if (!keyA || !keyB) return null;
    const override = FUSION_RULE_OVERRIDES.get(buildPairKey(keyA, keyB));
    if (override) {
        return normalizeArcanaKey(override) || null;
    }
    if (keyA === keyB) return keyA;
    const chartArc = resolveChartArcana(keyA, keyB);
    return chartArc || null;
}

/**
 * Generate a user-facing label describing a fusion pair.
 * @param {string} arcanaA
 * @param {string} arcanaB
 * @returns {string}
 */
export function describeFusionPair(arcanaA, arcanaB) {
    const keyA = normalizeArcanaKey(arcanaA);
    const keyB = normalizeArcanaKey(arcanaB);
    if (!keyA || !keyB) return "";
    const labelA = getArcanaLabel(keyA) || arcanaA;
    const labelB = getArcanaLabel(keyB) || arcanaB;
    return `${labelA} × ${labelB}`;
}

/**
 * Canonical moon phase keys that influence fusion behavior.
 * @type {{ FULL: "full", NEW: "new", OTHER: "other" }}
 */
export const MOON_PHASES = Object.freeze({
    FULL: "full",
    NEW: "new",
    OTHER: "other",
});

/**
 * User-facing moon phase select options.
 * @type {MoonPhaseOption[]}
 */
export const MOON_PHASE_OPTIONS = [
    { value: MOON_PHASES.FULL, label: "Full Moon" },
    { value: MOON_PHASES.NEW, label: "New Moon" },
    { value: MOON_PHASES.OTHER, label: "Other" },
];

/**
 * Normalize arbitrary moon phase strings to the supported set.
 * @param {string} value
 * @returns {string}
 */
export function normalizeMoonPhase(value) {
    const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (raw === MOON_PHASES.FULL) return MOON_PHASES.FULL;
    if (raw === MOON_PHASES.NEW) return MOON_PHASES.NEW;
    return MOON_PHASES.OTHER;
}

/**
 * Resolve a human-friendly label for a moon phase key.
 * @param {string} phase
 * @returns {string}
 */
export function formatMoonPhaseLabel(phase) {
    const normalized = normalizeMoonPhase(phase);
    const option = MOON_PHASE_OPTIONS.find((entry) => entry.value === normalized);
    return option ? option.label : "Other";
}

/**
 * Create a deterministic pseudo-random number generator seeded by a string.
 * Implementation based on cyrb53; returns values in the range [0, 1).
 * @param {string | number} seed
 * @returns {() => number}
 */
export function createSeededRng(seed) {
    const str = typeof seed === "string" ? seed : String(seed ?? "");
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i += 1) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    h = (Math.imul(h ^ (h >>> 16), 2246822507) + Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0;
    let state = h || 0x6d2b79f5;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Roll a deterministic d20 using the seeded RNG to support narrative flavor.
 * @param {string} seed
 * @returns {FusionRoll}
 */
function rollD20(seed) {
    const rng = createSeededRng(`${seed}|d20`);
    const value = Math.floor(rng() * 20) + 1;
    return {
        value,
        sides: 20,
        isCriticalHigh: value === 20,
        isCriticalLow: value === 1,
    };
}

/**
 * Build a randomized arcana order seeded by fusion metadata.
 * @param {string} seed
 * @returns {string[]}
 */
function buildRandomArcanaOrder(seed) {
    const rng = createSeededRng(`${seed}|arcana`);
    const start = Math.floor(rng() * FUSE_ARCANA_ORDER.length);
    return [
        ...FUSE_ARCANA_ORDER.slice(start),
        ...FUSE_ARCANA_ORDER.slice(0, start),
    ];
}

/**
 * Determine the rounding rule applied to average demon levels during fusion.
 * @param {string} moonPhase
 * @returns {FusionRounding}
 */
function computeRounding(moonPhase) {
    switch (moonPhase) {
        case MOON_PHASES.FULL:
            return { type: "ceil", shift: 1, label: "Round up twice" };
        case MOON_PHASES.NEW:
            return { type: "floor", shift: -1, label: "Round down twice" };
        default:
            return { type: "ceil", shift: 0, label: "Round up" };
    }
}

/**
 * Construct a deterministic fusion plan containing arcana candidates and metadata.
 * @param {{ demonA: any, demonB: any, fuseSeed: string, moonPhase: string }} params
 * @returns {FusionPlan | null}
 */
export function createFusionPlan({ demonA, demonB, fuseSeed, moonPhase }) {
    const seed = typeof fuseSeed === "string" ? fuseSeed.trim() : "";
    if (!seed || !demonA || !demonB) return null;
    const arcanaA = normalizeArcanaKey(demonA.arcana);
    const arcanaB = normalizeArcanaKey(demonB.arcana);
    if (!arcanaA || !arcanaB) return null;

    const identifierA = resolveFusionIdentifier(demonA) || arcanaA;
    const identifierB = resolveFusionIdentifier(demonB) || arcanaB;
    const pairKey = buildPairKey(`${arcanaA}:${identifierA}`, `${arcanaB}:${identifierB}`);

    const normalizedPhase = normalizeMoonPhase(moonPhase);
    const baseSeed = `${seed}|${pairKey}|${normalizedPhase}`;

    let roll = null;
    const notifications = [];
    if (normalizedPhase !== MOON_PHASES.OTHER) {
        roll = rollD20(baseSeed);
        if (normalizedPhase === MOON_PHASES.FULL && roll.isCriticalHigh) {
            notifications.push("The Moon shares its light with the players.");
        }
        if (normalizedPhase === MOON_PHASES.NEW && roll.isCriticalLow) {
            notifications.push("The Moon thanks the player for its donation.");
        }
    }

    let arcanaSource = "chart";
    let candidates = [];
    const chartArcana = resolveChartArcana(arcanaA, arcanaB);

    const shouldRandomize =
        (normalizedPhase === MOON_PHASES.FULL && roll?.isCriticalHigh) ||
        (normalizedPhase === MOON_PHASES.NEW && roll?.isCriticalLow);

    if (shouldRandomize) {
        arcanaSource = "random";
        candidates = buildRandomArcanaOrder(baseSeed);
    } else if (chartArcana) {
        candidates = [chartArcana];
    } else {
        const fallback = [...new Set([arcanaA, arcanaB].filter(Boolean))];
        candidates = fallback.length > 0 ? fallback : [...FUSE_ARCANA_ORDER];
    }

    return {
        pairKey,
        arcanaA,
        arcanaB,
        baseSeed,
        moonPhase: normalizedPhase,
        roll,
        notifications,
        arcanaSource,
        arcanaCandidates: candidates,
        baseArcana: chartArcana,
        rounding: computeRounding(normalizedPhase),
    };
}

/**
 * Choose the resulting demon from a fusion plan given the available demon list.
 * Applies rounding, tie-breaking, and seeded randomness to make decisions repeatable.
 * @param {{ plan: FusionPlan | null, demons: any[], arcanaKey: string, arcanaLabel: string, demonA?: any, demonB?: any }} options
 * @returns {FusionResult | null}
 */
export function resolveFusionResult({ plan, demons, arcanaKey, arcanaLabel, demonA, demonB }) {
    if (!plan || !Array.isArray(demons) || demons.length === 0) {
        return null;
    }
    const levelA = Number(demonA?.level);
    const levelB = Number(demonB?.level);
    const hasLevels = Number.isFinite(levelA) && Number.isFinite(levelB);
    const averageLevel = hasLevels ? (levelA + levelB) / 2 : null;

    let index = -1;
    if (hasLevels) {
        if (plan.rounding.type === "floor") {
            for (let i = demons.length - 1; i >= 0; i -= 1) {
                const level = Number(demons[i]?.level);
                if (Number.isFinite(level) && level <= averageLevel) {
                    index = i;
                    break;
                }
            }
            if (index === -1) index = 0;
        } else {
            index = demons.findIndex((entry) => Number(entry?.level) >= averageLevel);
            if (index === -1) index = demons.length - 1;
        }
    } else {
        index = plan.rounding.type === "floor" ? demons.length - 1 : 0;
    }

    if (plan.rounding.shift) {
        index = Math.min(demons.length - 1, Math.max(0, index + plan.rounding.shift));
    }

    if (index < 0 || index >= demons.length) {
        index = Math.max(0, Math.min(demons.length - 1, index));
    }

    const selected = demons[index];
    if (!selected) return null;

    const targetLevel = Number(selected.level);
    let tieCandidates = [index];
    if (Number.isFinite(targetLevel)) {
        tieCandidates = demons
            .map((entry, idx) => ({ idx, level: Number(entry?.level) }))
            .filter((entry) => Number.isFinite(entry.level) && entry.level === targetLevel)
            .map((entry) => entry.idx);
    }

    let chosenIndex = index;
    if (tieCandidates.length > 1) {
        const tieSeed = `${plan.baseSeed}|${arcanaKey}|level:${targetLevel}`;
        const rng = createSeededRng(tieSeed);
        const choice = Math.floor(rng() * tieCandidates.length);
        chosenIndex = tieCandidates[choice];
    }

    return {
        arcanaKey,
        arcanaLabel,
        demon: demons[chosenIndex] || null,
        averageLevel,
        rounding: plan.rounding,
        targetLevel: Number.isFinite(targetLevel) ? targetLevel : null,
        tieCount: tieCandidates.length,
        selectedIndex: chosenIndex,
    };
}
