import { ABILITY_DEFS } from '../constants/gameData';

export function computeAbilityModifier(stats, ability) {
    if (!ability) return 0;
    const entry = resolveAbilityStat(stats, ability);
    const { score, modifier } = extractAbilityMetrics(entry);
    if (modifier !== null) return modifier;
    if (score !== null) return Math.floor((score - 10) / 2);
    return 0;
}

export function resolveAbilityStat(stats, ability) {
    if (!stats || !ability) return null;
    const normalized = ability.toUpperCase();
    const keyVariants = [normalized, normalized.toLowerCase(), normalized.toUpperCase()];

    if (Array.isArray(stats)) {
        for (const item of stats) {
            if (!item || typeof item !== 'object') continue;
            const direct = resolveAbilityStat(item, ability);
            if (direct !== null && direct !== undefined) return direct;
        }
        return null;
    }

    if (typeof stats !== 'object') return null;

    for (const key of keyVariants) {
        if (key && Object.prototype.hasOwnProperty.call(stats, key)) {
            return stats[key];
        }
    }

    const nestedSources = [stats.abilities, stats.stats, stats.values].filter(
        (candidate) => candidate && candidate !== stats
    );
    for (const candidate of nestedSources) {
        const resolved = resolveAbilityStat(candidate, ability);
        if (resolved !== null && resolved !== undefined) return resolved;
    }

    for (const value of Object.values(stats)) {
        if (!value || typeof value !== 'object') continue;
        const abilityKey = typeof value.ability === 'string' ? value.ability.trim().toUpperCase() : '';
        const nameKey = typeof value.name === 'string' ? value.name.trim().toUpperCase() : '';
        const keyKey = typeof value.key === 'string' ? value.key.trim().toUpperCase() : '';
        if (abilityKey === normalized || nameKey === normalized || keyKey === normalized) {
            return value;
        }
    }

    return null;
}

export function extractAbilityMetrics(entry) {
    const result = { score: null, modifier: null };
    if (entry === null || entry === undefined) return result;

    if (typeof entry === 'number') {
        if (Number.isFinite(entry)) result.score = entry;
        return result;
    }

    if (typeof entry === 'string') {
        const parsed = parseNumeric(entry);
        if (parsed !== null) result.score = parsed;
        return result;
    }

    if (typeof entry !== 'object') return result;

    const modifierKeys = ['modifier', 'mod', 'bonus'];
    for (const key of modifierKeys) {
        const value = entry[key];
        const numeric = parseNumeric(value);
        if (numeric !== null) {
            result.modifier = numeric;
            break;
        }
    }

    if (result.modifier !== null) return result;

    const scoreKeys = ['total', 'score', 'value', 'base', 'current'];
    for (const key of scoreKeys) {
        const value = entry[key];
        const numeric = parseNumeric(value);
        if (numeric !== null) {
            result.score = numeric;
            return result;
        }
    }

    if (typeof entry.amount !== 'undefined') {
        const numeric = parseNumeric(entry.amount);
        if (numeric !== null) result.score = numeric;
    }

    return result;
}

export function describeAbilityLabel(key) {
    const normalized = typeof key === 'string' ? key.toUpperCase() : '';
    const found = ABILITY_DEFS.find((ability) => ability.key === normalized);
    return found ? found.label : normalized || 'Ability';
}

export function parseNumeric(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
        const match = value.match(/-?\d+(?:\.\d+)?/);
        if (match) {
            const parsed = Number(match[0]);
            return Number.isFinite(parsed) ? parsed : null;
        }
    }
    return null;
}
