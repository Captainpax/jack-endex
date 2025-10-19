<template>
    <div class="world-skills-pane">
        <p v-if="!player" class="world-skills-pane__placeholder">{{ emptyPlayerText }}</p>
        <p v-else-if="!character" class="world-skills-pane__placeholder">{{ emptyCharacterText }}</p>
        <p v-else-if="!skills.length" class="world-skills-pane__placeholder">{{ emptySkillsText }}</p>
        <table v-else class="world-skills-pane__table">
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
                        <div class="world-skills-pane__name">
                            <span>{{ skill.label }}</span>
                            <span class="world-skills-pane__ability">{{ skill.ability }}</span>
                        </div>
                        <p v-if="skill.summary" class="world-skills-pane__summary">{{ skill.summary }}</p>
                    </th>
                    <td>{{ skill.ranks ?? '—' }}</td>
                    <td>{{ formatModifier(skill.misc) }}</td>
                    <td>
                        <div>{{ formatModifier(skill.modifier) }}</div>
                        <p class="world-skills-pane__breakdown">
                            Ability {{ formatModifier(skill.abilityModifier) }} · Ranks
                            {{ formatModifier(skill.ranks) }} · Misc {{ formatModifier(skill.misc) }}
                        </p>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>

<script setup>
import { computed, toRef } from 'vue';

import { DEFAULT_WORLD_SKILL_DEFS } from '@shared/worldSkills.js';

import { normalizeCharacter } from '../../utils/character';
import { computeAbilityModifier } from '../../utils/sheetStats';

const props = defineProps({
    game: { type: Object, default: null },
    player: { type: Object, default: null },
    emptyPlayerText: { type: String, default: 'No player selected.' },
    emptyCharacterText: { type: String, default: 'No character sheet available.' },
    emptySkillsText: { type: String, default: 'No skills recorded.' },
});

const gameRef = toRef(props, 'game');
const playerRef = toRef(props, 'player');

const SUMMARY_BY_KEY = new Map(
    DEFAULT_WORLD_SKILL_DEFS.map((skill) => [skill.key.toLowerCase(), skill.summary || ''])
);
const SUMMARY_BY_LABEL = new Map(
    DEFAULT_WORLD_SKILL_DEFS.map((skill) => [skill.label.toLowerCase(), skill.summary || ''])
);

const worldSkills = computed(() => (Array.isArray(gameRef.value?.worldSkills) ? gameRef.value.worldSkills : []));

const character = computed(() => {
    const source = playerRef.value?.character;
    if (!source || typeof source !== 'object') return null;
    return normalizeCharacter(source, worldSkills.value);
});

const skills = computed(() => {
    const activeCharacter = character.value;
    if (!activeCharacter) return [];
    const stats = playerRef.value?.character?.stats || {};
    const skillMap = activeCharacter.skills || {};

    return worldSkills.value.map((entry) => {
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

function formatModifier(value) {
    if (value === null || value === undefined) return '—';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    if (numeric === 0) return '0';
    return numeric > 0 ? `+${numeric}` : `${numeric}`;
}
</script>

<style scoped>
.world-skills-pane {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.world-skills-pane__placeholder {
    margin: 0;
    color: rgba(255, 255, 255, 0.6);
}

.world-skills-pane__table {
    width: 100%;
    border-collapse: collapse;
    background: rgba(12, 15, 30, 0.6);
    border-radius: 0.9rem;
    overflow: hidden;
}

.world-skills-pane__table th,
.world-skills-pane__table td {
    padding: 0.75rem 1rem;
    text-align: left;
}

.world-skills-pane__name {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-weight: 600;
}

.world-skills-pane__ability {
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.7);
}

.world-skills-pane__summary {
    margin: 0.35rem 0 0;
    color: rgba(255, 255, 255, 0.75);
    font-size: 0.9rem;
}

.world-skills-pane__breakdown {
    margin: 0.35rem 0 0;
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.8rem;
}

.world-skills-pane__table thead {
    background: rgba(255, 255, 255, 0.08);
}

.world-skills-pane__table tbody tr:nth-child(2n) {
    background: rgba(255, 255, 255, 0.03);
}
</style>
