<template>
    <div class="character-pane">
        <p v-if="!player" class="character-pane__placeholder">{{ emptyPlayerText }}</p>
        <p v-else-if="!character" class="character-pane__placeholder">{{ emptyCharacterText }}</p>
        <div v-else class="character-pane__layout">
            <section class="character-pane__section">
                <h4 class="character-pane__section-title">Profile</h4>
                <dl v-if="profileEntries.length" class="character-pane__details">
                    <div v-for="entry in profileEntries" :key="entry.key" class="character-pane__details-row">
                        <dt>{{ entry.label }}</dt>
                        <dd>{{ entry.value }}</dd>
                    </div>
                </dl>
                <p v-else class="character-pane__placeholder">No profile details recorded.</p>
            </section>

            <section class="character-pane__section">
                <h4 class="character-pane__section-title">Abilities</h4>
                <ul v-if="abilityEntries.length" class="character-pane__abilities">
                    <li v-for="ability in abilityEntries" :key="ability.key" class="character-pane__ability">
                        <header class="character-pane__ability-header">
                            <span class="character-pane__ability-name">{{ ability.label }}</span>
                            <span class="character-pane__ability-mod">{{ formatModifier(ability.modifier) }}</span>
                        </header>
                        <p class="character-pane__ability-score">Score {{ ability.score ?? '—' }}</p>
                    </li>
                </ul>
                <p v-else class="character-pane__placeholder">No ability scores recorded.</p>
            </section>

            <section class="character-pane__section">
                <h4 class="character-pane__section-title">Resources</h4>
                <dl v-if="resourceEntries.length" class="character-pane__details">
                    <div v-for="entry in resourceEntries" :key="entry.key" class="character-pane__details-row">
                        <dt>{{ entry.label }}</dt>
                        <dd>{{ entry.value }}</dd>
                    </div>
                </dl>
                <p v-else class="character-pane__placeholder">No resources tracked.</p>
                <p v-if="usesTP" class="character-pane__hint">This character spends TP instead of MP.</p>
            </section>

            <section v-if="customSkills.length" class="character-pane__section character-pane__section--wide">
                <h4 class="character-pane__section-title">Custom Skills</h4>
                <ul class="character-pane__custom-skills">
                    <li v-for="skill in customSkills" :key="skill.id" class="character-pane__custom-skill">
                        <header class="character-pane__custom-skill-header">
                            <span class="character-pane__custom-skill-name">{{ skill.label }}</span>
                            <span v-if="skill.ability" class="character-pane__custom-skill-ability">
                                {{ skill.ability }}
                            </span>
                        </header>
                        <p class="character-pane__custom-skill-body">
                            Ranks {{ formatModifier(skill.ranks) }} · Misc {{ formatModifier(skill.misc) }}
                        </p>
                    </li>
                </ul>
            </section>
        </div>
    </div>
</template>

<script setup>
import { computed, toRef } from 'vue';

import { normalizeCharacter } from '../../utils/character';
import {
    computeAbilityModifier,
    describeAbilityLabel,
    extractAbilityMetrics,
    resolveAbilityStat,
} from '../../utils/sheetStats';

const props = defineProps({
    game: { type: Object, default: null },
    player: { type: Object, default: null },
    emptyPlayerText: { type: String, default: 'No player selected.' },
    emptyCharacterText: { type: String, default: 'No character sheet available.' },
});

const gameRef = toRef(props, 'game');
const playerRef = toRef(props, 'player');

const worldSkills = computed(() => (Array.isArray(gameRef.value?.worldSkills) ? gameRef.value.worldSkills : []));

const character = computed(() => {
    const source = playerRef.value?.character;
    if (!source || typeof source !== 'object') return null;
    return normalizeCharacter(source, worldSkills.value);
});

const usesTP = computed(() => !!character.value?.resources?.useTP);

const profileEntries = computed(() => collectProfileEntries(character.value?.profile || {}));

const resourceEntries = computed(() => collectResourceEntries(character.value?.resources || {}));

const abilityEntries = computed(() => {
    const stats = character.value?.stats;
    if (!stats) return [];
    const abilityKeys = new Set();
    const entries = [];

    const defaultKeys = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
    for (const key of defaultKeys) {
        abilityKeys.add(key);
        const entry = resolveAbilityStat(stats, key);
        const { score, modifier } = extractAbilityMetrics(entry);
        if (score === null && modifier === null) continue;
        entries.push({
            key,
            label: describeAbilityLabel(key),
            score: score !== null ? score : null,
            modifier:
                modifier !== null ? modifier : score !== null ? Math.floor((score - 10) / 2) : computeAbilityModifier(stats, key),
        });
    }

    // Include any additional ability-like entries that aren't part of the default set.
    const supplemental = extractAdditionalAbilityKeys(stats, abilityKeys);
    for (const key of supplemental) {
        const entry = resolveAbilityStat(stats, key);
        const { score, modifier } = extractAbilityMetrics(entry);
        if (score === null && modifier === null) continue;
        entries.push({
            key,
            label: describeAbilityLabel(key),
            score: score !== null ? score : null,
            modifier:
                modifier !== null ? modifier : score !== null ? Math.floor((score - 10) / 2) : computeAbilityModifier(stats, key),
        });
    }

    return entries;
});

const customSkills = computed(() => {
    const list = Array.isArray(character.value?.customSkills) ? character.value.customSkills : [];
    return list
        .map((skill, index) => ({
            id: skill.id || skill.key || `custom:${index}`,
            label: skill.label || skill.name || 'Custom skill',
            ability: typeof skill.ability === 'string' ? skill.ability : '',
            ranks: Number.isFinite(skill.ranks) ? skill.ranks : 0,
            misc: Number.isFinite(skill.misc) ? skill.misc : 0,
        }))
        .filter((skill) => skill.label);
});

function formatModifier(value) {
    if (value === null || value === undefined) return '—';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    if (numeric === 0) return '0';
    return numeric > 0 ? `+${numeric}` : `${numeric}`;
}

function collectProfileEntries(profile) {
    const entries = [];
    if (!profile || typeof profile !== 'object') return entries;
    for (const [key, raw] of Object.entries(profile)) {
        if (raw === null || raw === undefined) continue;
        let value = '';
        if (Array.isArray(raw)) {
            value = raw.map((item) => formatPrimitive(item)).filter(Boolean).join(', ');
        } else if (typeof raw === 'object') {
            continue;
        } else {
            value = formatPrimitive(raw);
        }
        if (!value) continue;
        entries.push({ key, label: formatLabel(key), value });
    }
    return entries;
}

function collectResourceEntries(resources) {
    const entries = [];
    if (!resources || typeof resources !== 'object') return entries;
    for (const [key, raw] of Object.entries(resources)) {
        if (key === 'useTP') continue;
        const value = formatResourceValue(raw);
        if (!value) continue;
        entries.push({ key, label: formatLabel(key), value });
    }
    return entries;
}

function extractAdditionalAbilityKeys(stats, existingKeys) {
    const found = new Set();
    if (!stats || typeof stats !== 'object') return found;

    const sources = [stats, stats.abilities, stats.stats, stats.values];
    for (const source of sources) {
        if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
        for (const value of Object.values(source)) {
            if (!value || typeof value !== 'object') continue;
            const ability = typeof value.ability === 'string' ? value.ability.trim().toUpperCase() : '';
            if (ability && !existingKeys.has(ability)) {
                found.add(ability);
            }
        }
    }

    return found;
}

function formatPrimitive(value) {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return '';
}

function formatResourceValue(raw) {
    if (raw === null || raw === undefined) return '';
    if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : '';
    if (typeof raw === 'string') return raw.trim();
    if (Array.isArray(raw)) {
        return raw.map((item) => formatPrimitive(item)).filter(Boolean).join(', ');
    }
    if (typeof raw === 'object') {
        const current = raw.current ?? raw.value ?? raw.amount ?? null;
        const max = raw.max ?? raw.total ?? null;
        const currentValue = formatPrimitive(current ?? '');
        const maxValue = formatPrimitive(max ?? '');
        if (currentValue && maxValue) return `${currentValue} / ${maxValue}`;
        if (currentValue) return currentValue;
        if (maxValue) return maxValue;
    }
    return '';
}

function formatLabel(key) {
    if (!key) return '';
    return String(key)
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[-_]+/g, ' ')
        .replace(/^\w/, (char) => char.toUpperCase());
}
</script>

<style scoped>
.character-pane {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

.character-pane__placeholder {
    margin: 0;
    color: rgba(255, 255, 255, 0.6);
}

.character-pane__layout {
    display: grid;
    gap: 1.25rem;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
}

.character-pane__section {
    background: rgba(12, 15, 30, 0.6);
    border-radius: 0.9rem;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.character-pane__section--wide {
    grid-column: 1 / -1;
}

.character-pane__section-title {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
}

.character-pane__details {
    margin: 0;
    display: grid;
    gap: 0.5rem;
}

.character-pane__details-row {
    display: flex;
    gap: 0.5rem;
    font-size: 0.95rem;
}

.character-pane__details-row dt {
    font-weight: 600;
}

.character-pane__details-row dd {
    margin: 0;
}

.character-pane__abilities {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
}

.character-pane__ability {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.character-pane__ability-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
}

.character-pane__ability-name {
    font-weight: 600;
}

.character-pane__ability-mod {
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.7);
}

.character-pane__ability-score {
    margin: 0;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.75);
}

.character-pane__hint {
    margin: 0;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.7);
}

.character-pane__custom-skills {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.75rem;
}

.character-pane__custom-skill {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}

.character-pane__custom-skill-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
}

.character-pane__custom-skill-name {
    font-weight: 600;
}

.character-pane__custom-skill-ability {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.7);
}

.character-pane__custom-skill-body {
    margin: 0;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.75);
}
</style>
