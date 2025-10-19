<template>
    <section class="panel">
        <header class="panel__header">
            <h3 class="panel__title">World skills</h3>
            <label v-if="isDM && playerOptions.length" class="panel__picker">
                <span class="sr-only">Inspect player</span>
                <select v-model="selectedPlayerKey" class="panel__picker-select">
                    <option v-for="option in playerOptions" :key="option.key" :value="option.key">
                        {{ option.label }}
                    </option>
                </select>
            </label>
        </header>
        <p v-if="!activePlayer" class="panel__placeholder">No player selected.</p>
        <p v-else-if="!activeCharacter" class="panel__placeholder">No character sheet available.</p>
        <p v-else-if="!skills.length" class="panel__placeholder">No skills recorded.</p>
        <table v-else class="skills-table">
            <thead>
                <tr>
                    <th scope="col">Skill</th>
                    <th scope="col">Ranks</th>
                    <th scope="col">Misc</th>
                    <th scope="col">Total</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="skill in skills" :key="skill.id || skill.label">
                    <th scope="row">
                        <div class="skills-table__name">
                            <span>{{ skill.label }}</span>
                            <span class="skills-table__ability">{{ skill.ability }}</span>
                        </div>
                        <p v-if="skill.summary" class="skills-table__summary">{{ skill.summary }}</p>
                    </th>
                    <td>{{ skill.ranks ?? '—' }}</td>
                    <td>{{ formatModifier(skill.misc) }}</td>
                    <td>
                        <div>{{ formatModifier(skill.modifier) }}</div>
                        <p class="skills-table__breakdown">
                            Ability {{ formatModifier(skill.abilityModifier) }} · Ranks
                            {{ formatModifier(skill.ranks) }} · Misc {{ formatModifier(skill.misc) }}
                        </p>
                    </td>
                </tr>
            </tbody>
        </table>
    </section>
</template>

<script setup>
import { computed, ref, watchEffect } from 'vue';

import { DEFAULT_WORLD_SKILL_DEFS } from '@shared/worldSkills.js';

import { normalizeCharacter } from '../utils/character';
import { idsMatch, normalizeId } from '../utils/ids';

const props = defineProps({
    game: { type: Object, required: true },
    me: { type: Object, default: null },
});

const SUMMARY_BY_KEY = new Map(
    DEFAULT_WORLD_SKILL_DEFS.map((skill) => [skill.key.toLowerCase(), skill.summary || ''])
);
const SUMMARY_BY_LABEL = new Map(
    DEFAULT_WORLD_SKILL_DEFS.map((skill) => [skill.label.toLowerCase(), skill.summary || ''])
);

const isDM = computed(() => idsMatch(props.game?.dmId, props.me?.id));

const players = computed(() => {
    if (!props.game || !Array.isArray(props.game.players)) return [];
    return props.game.players.filter((player) => player && typeof player === 'object');
});

const selectablePlayers = computed(() => {
    const filtered = players.value.filter((player) => {
        const role = typeof player.role === 'string' ? player.role.trim().toLowerCase() : '';
        return role !== 'dm';
    });
    return filtered.length ? filtered : players.value;
});

const playerOptions = computed(() =>
    selectablePlayers.value.map((player, index) => ({
        key: resolvePlayerKey(player, index),
        label: describePlayerName(player),
        player,
    }))
);

const selectedPlayerKey = ref(null);

watchEffect(() => {
    if (!isDM.value) {
        selectedPlayerKey.value = null;
        return;
    }
    const options = playerOptions.value;
    if (!options.length) {
        selectedPlayerKey.value = null;
        return;
    }
    if (options.some((option) => option.key === selectedPlayerKey.value)) {
        return;
    }
    selectedPlayerKey.value = options[0].key;
});

const activePlayer = computed(() => {
    if (isDM.value) {
        const options = playerOptions.value;
        if (!options.length) return null;
        const match = options.find((option) => option.key === selectedPlayerKey.value);
        return (match || options[0]).player;
    }

    const user = props.me;
    if (user) {
        const found = players.value.find((player) => playerMatchesUser(player, user));
        if (found) return found;
    }

    return selectablePlayers.value[0] || null;
});

const activeCharacter = computed(() => {
    const character = activePlayer.value?.character;
    if (!character || typeof character !== 'object') return null;
    const worldSkills = Array.isArray(props.game?.worldSkills) ? props.game.worldSkills : [];
    return normalizeCharacter(character, worldSkills);
});

const skills = computed(() => {
    const character = activeCharacter.value;
    if (!character) return [];
    const worldSkills = Array.isArray(props.game?.worldSkills) ? props.game.worldSkills : [];
    const stats = activePlayer.value?.character?.stats || {};
    const skillMap = character.skills || {};

    return worldSkills.map((entry) => {
        const key = typeof entry.id === 'string' && entry.id ? entry.id : entry.key;
        const normalized = key && skillMap[key] ? skillMap[key] : { ranks: 0, misc: 0 };
        const ranks = Number.isFinite(normalized?.ranks) ? normalized.ranks : 0;
        const misc = Number.isFinite(normalized?.misc) ? normalized.misc : 0;
        const ability = typeof entry.ability === 'string' ? entry.ability.toUpperCase() : '';
        const abilityModifier = computeAbilityModifier(stats, ability);
        const modifier = abilityModifier + ranks + misc;
        const summary = lookupSkillSummary(entry);
        return {
            id: key,
            label: entry.label || entry.name || key,
            ability,
            ranks,
            misc,
            abilityModifier,
            modifier,
            summary,
        };
    });
});

function lookupSkillSummary(entry) {
    const key = typeof entry?.id === 'string' && entry.id ? entry.id : entry?.key;
    if (key) {
        const byKey = SUMMARY_BY_KEY.get(key.toLowerCase());
        if (byKey) return byKey;
    }
    const label = typeof entry?.label === 'string' ? entry.label : entry?.name;
    if (label) {
        const byLabel = SUMMARY_BY_LABEL.get(label.toLowerCase());
        if (byLabel) return byLabel;
    }
    return '';
}

function computeAbilityModifier(stats, ability) {
    if (!ability) return 0;
    const entry = resolveAbilityStat(stats, ability);
    const { score, modifier } = extractAbilityMetrics(entry);
    if (modifier !== null) return modifier;
    if (score !== null) return Math.floor((score - 10) / 2);
    return 0;
}

function resolveAbilityStat(stats, ability) {
    if (!stats) return null;
    const keyVariants = [ability, ability.toLowerCase(), ability.toUpperCase()];

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

    const candidates = [stats.abilities, stats.stats, stats.values].filter(
        (candidate) => candidate && candidate !== stats
    );
    for (const candidate of candidates) {
        const resolved = resolveAbilityStat(candidate, ability);
        if (resolved !== null && resolved !== undefined) return resolved;
    }

    for (const value of Object.values(stats)) {
        if (!value || typeof value !== 'object') continue;
        const abilityKey = typeof value.ability === 'string' ? value.ability.trim().toUpperCase() : '';
        const nameKey = typeof value.name === 'string' ? value.name.trim().toUpperCase() : '';
        const keyKey = typeof value.key === 'string' ? value.key.trim().toUpperCase() : '';
        if (abilityKey === ability || nameKey === ability || keyKey === ability) {
            return value;
        }
    }

    return null;
}

function extractAbilityMetrics(entry) {
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

function parseNumeric(value) {
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

function resolvePlayerKey(player, index = 0) {
    const identifiers = collectPlayerIdentifiers(player);
    if (identifiers.length) return identifiers[0];
    return `player:${index + 1}`;
}

function playerMatchesUser(player, user) {
    if (!player || !user) return false;
    const playerIds = collectPlayerIdentifiers(player);
    const userIds = [normalizeId(user.id), normalizeId(user.userId), normalizeId(user.user?.id)].filter(Boolean);
    for (const playerId of playerIds) {
        if (userIds.some((id) => id && idsMatch(id, playerId))) {
            return true;
        }
    }
    return false;
}

function collectPlayerIdentifiers(player) {
    if (!player || typeof player !== 'object') return [];
    const ids = [player.userId, player.id, player.user?.id]
        .map((value) => normalizeId(value))
        .filter((value, index, array) => value && array.indexOf(value) === index);
    return ids;
}

function describePlayerName(player) {
    if (!player || typeof player !== 'object') return 'Unknown player';
    const charName = typeof player.character?.name === 'string' ? player.character.name.trim() : '';
    if (charName) return charName;
    const displayName = typeof player.displayName === 'string' ? player.displayName.trim() : '';
    if (displayName) return displayName;
    const username = typeof player.username === 'string' ? player.username.trim() : '';
    if (username) return username;
    const userId = typeof player.userId === 'string' ? player.userId.trim() : '';
    if (userId) return userId;
    return 'Unknown player';
}

function formatModifier(mod) {
    if (mod === null || mod === undefined || mod === '') return '0';
    const value = Number(mod);
    if (!Number.isFinite(value)) return String(mod);
    return value >= 0 ? `+${value}` : `${value}`;
}
</script>

<style scoped>
.panel {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.panel__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.panel__title {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
}

.panel__picker {
    display: inline-flex;
    align-items: center;
}

.panel__picker-select {
    appearance: none;
    background: rgba(12, 15, 30, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 0.6rem;
    color: inherit;
    font: inherit;
    padding: 0.35rem 0.75rem;
}

.skills-table {
    width: 100%;
    border-collapse: collapse;
    background: rgba(12, 15, 30, 0.6);
    border-radius: 0.9rem;
    overflow: hidden;
}

.skills-table th,
.skills-table td {
    padding: 0.75rem 1rem;
    text-align: left;
}

.skills-table__name {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-weight: 600;
}

.skills-table__ability {
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.7);
}

.skills-table__summary {
    margin: 0.35rem 0 0;
    color: rgba(255, 255, 255, 0.75);
    font-size: 0.9rem;
}

.skills-table__breakdown {
    margin: 0.35rem 0 0;
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.8rem;
}

.skills-table thead {
    background: rgba(255, 255, 255, 0.08);
}

.skills-table tbody tr:nth-child(2n) {
    background: rgba(255, 255, 255, 0.03);
}

.panel__placeholder {
    color: rgba(255, 255, 255, 0.6);
}
</style>
