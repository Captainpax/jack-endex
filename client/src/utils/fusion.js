import { ARCANA_DATA } from "../constants/gameData";

const ARCANA_KEYS = ARCANA_DATA.map((entry) => entry.key);
const ARCANA_LABEL_BY_KEY = new Map(ARCANA_DATA.map((entry) => [entry.key, entry.label]));
const ARCANA_KEY_BY_LABEL = new Map(
    ARCANA_DATA.map((entry) => [entry.label.toLowerCase(), entry.key]),
);

const FUSION_RULE_OVERRIDES = new Map();

function buildPairKey(a, b) {
    const list = [a, b].map((value) => value || "").sort();
    return list.join("+");
}

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
    return "";
}

export function getArcanaLabel(key) {
    const normalized = normalizeArcanaKey(key);
    return normalized ? ARCANA_LABEL_BY_KEY.get(normalized) || "" : "";
}

export function listArcanaOptions() {
    return ARCANA_DATA.map((entry) => ({ key: entry.key, label: entry.label }));
}

export function suggestFusionArcana(arcanaA, arcanaB) {
    const keyA = normalizeArcanaKey(arcanaA);
    const keyB = normalizeArcanaKey(arcanaB);
    if (!keyA || !keyB) return null;
    const override = FUSION_RULE_OVERRIDES.get(buildPairKey(keyA, keyB));
    if (override) {
        return normalizeArcanaKey(override) || null;
    }
    if (keyA === keyB) return keyA;
    const indexA = ARCANA_KEYS.indexOf(keyA);
    const indexB = ARCANA_KEYS.indexOf(keyB);
    if (indexA === -1 || indexB === -1) return null;
    const averageIndex = Math.round((indexA + indexB) / 2);
    return ARCANA_KEYS[averageIndex] || null;
}

export function describeFusionPair(arcanaA, arcanaB) {
    const keyA = normalizeArcanaKey(arcanaA);
    const keyB = normalizeArcanaKey(arcanaB);
    if (!keyA || !keyB) return "";
    const labelA = getArcanaLabel(keyA) || arcanaA;
    const labelB = getArcanaLabel(keyB) || arcanaB;
    return `${labelA} × ${labelB}`;
}
