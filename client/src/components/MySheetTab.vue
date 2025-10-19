<template>
    <section class="sheet">
        <header class="sheet__header">
            <div class="sheet__identity">
                <h3 class="sheet__title">{{ characterTitle }}</h3>
                <p class="sheet__subtitle">{{ characterSubtitle }}</p>
                <p v-if="activeSlug" class="sheet__slug">Slug · <code>{{ activeSlug }}</code></p>
            </div>
            <div class="sheet__controls">
                <label v-if="isDM && playerOptions.length" class="sheet__picker">
                    <span class="sr-only">Inspect player</span>
                    <select v-model="selectedPlayerKey" class="sheet__picker-select">
                        <option v-for="option in playerOptions" :key="option.key" :value="option.key">
                            {{ option.label }}
                        </option>
                    </select>
                </label>
            </div>
        </header>
        <nav class="sheet__nav" aria-label="Character sheet sections">
            <button
                v-for="section in sections"
                :key="section.key"
                type="button"
                class="sheet__nav-button"
                :class="{ 'sheet__nav-button--active': activeSection === section.key }"
                @click="setSection(section.key)"
            >
                {{ section.label }}
            </button>
        </nav>
        <div class="sheet__body">
            <CharacterSheetPane
                v-if="activeSection === 'character'"
                :game="gameRef"
                :player="activePlayer"
                empty-player-text="No player selected."
            />
            <GearSheetPane
                v-else-if="activeSection === 'gear'"
                :player="activePlayer"
                empty-player-text="No player selected."
            />
            <WorldSkillsSheetPane
                v-else
                :game="gameRef"
                :player="activePlayer"
                empty-player-text="No player selected."
            />
        </div>
    </section>
</template>

<script setup>
import { computed, ref, toRef, watch } from 'vue';

import CharacterSheetPane from './sheet/CharacterSheetPane.vue';
import GearSheetPane from './sheet/GearSheetPane.vue';
import WorldSkillsSheetPane from './sheet/WorldSkillsSheetPane.vue';
import { useSheetPlayerContext, describePlayerName } from '../composables/useSheetPlayerContext';

const SECTION_KEYS = ['character', 'gear', 'worldSkills'];

const props = defineProps({
    game: { type: Object, required: true },
    me: { type: Object, default: null },
    slug: { type: String, default: '' },
    section: { type: String, default: '' },
});

const emit = defineEmits(['update:slug', 'update:section']);

const gameRef = toRef(props, 'game');

const slugState = ref(normalizeSlug(props.slug));
const sectionState = ref(resolveSection(props.section));

watch(
    () => props.slug,
    (value) => {
        const normalized = normalizeSlug(value);
        if (normalized !== slugState.value) {
            slugState.value = normalized;
        }
    }
);

watch(
    () => props.section,
    (value) => {
        const normalized = resolveSection(value);
        if (normalized !== sectionState.value) {
            sectionState.value = normalized;
        }
    }
);

watch(
    slugState,
    (value) => {
        const normalized = normalizeSlug(props.slug);
        if (value !== normalized) {
            emit('update:slug', value);
        }
    }
);

watch(
    sectionState,
    (value) => {
        const normalized = resolveSection(props.section);
        if (value !== normalized) {
            emit('update:section', value);
        }
    }
);

const { isDM, playerOptions, selectedPlayerKey, activePlayer, activeSlug } = useSheetPlayerContext({
    game: gameRef,
    me: toRef(props, 'me'),
    slug: slugState,
});

const sections = [
    { key: 'character', label: 'Character' },
    { key: 'gear', label: 'Gear' },
    { key: 'worldSkills', label: 'World Skills' },
];

const activeSection = computed(() => sectionState.value);

const characterTitle = computed(() => {
    const player = activePlayer.value;
    if (!player) return 'No player selected';
    const name = typeof player.character?.name === 'string' ? player.character.name.trim() : '';
    return name || describePlayerName(player);
});

const characterSubtitle = computed(() => {
    const player = activePlayer.value;
    if (!player) return 'Choose a party member to inspect their sheet.';
    const displayName = describePlayerOwner(player);
    if (isDM.value) {
        return `Viewing ${displayName}`;
    }
    return displayName ? `Playing as ${displayName}` : 'Playing as your character';
});

function setSection(key) {
    const normalized = resolveSection(key);
    if (normalized && normalized !== sectionState.value) {
        sectionState.value = normalized;
    }
}

function describePlayerOwner(player) {
    if (!player || typeof player !== 'object') return '';
    const displayName = typeof player.displayName === 'string' ? player.displayName.trim() : '';
    if (displayName) return displayName;
    const username = typeof player.username === 'string' ? player.username.trim() : '';
    if (username) return username;
    const email = typeof player.email === 'string' ? player.email.trim() : '';
    if (email) return email;
    return describePlayerName(player);
}

function normalizeSlug(value) {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
}

function resolveSection(value) {
    const key = typeof value === 'string' ? value.trim() : '';
    return SECTION_KEYS.includes(key) ? key : 'character';
}
</script>

<style scoped>
.sheet {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
}

.sheet__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
}

.sheet__identity {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}

.sheet__title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
}

.sheet__subtitle {
    margin: 0;
    color: rgba(255, 255, 255, 0.7);
}

.sheet__slug {
    margin: 0;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.6);
}

.sheet__slug code {
    font-family: inherit;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 0.4rem;
    padding: 0.1rem 0.4rem;
}

.sheet__controls {
    display: flex;
    gap: 0.75rem;
}

.sheet__picker {
    display: inline-flex;
    align-items: center;
}

.sheet__picker-select {
    appearance: none;
    background: rgba(12, 15, 30, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 0.6rem;
    color: inherit;
    font: inherit;
    padding: 0.35rem 0.75rem;
}

.sheet__nav {
    display: inline-flex;
    gap: 0.75rem;
}

.sheet__nav-button {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 0.75rem;
    color: inherit;
    cursor: pointer;
    font: inherit;
    padding: 0.4rem 0.95rem;
    transition: background 0.2s ease, border-color 0.2s ease;
}

.sheet__nav-button--active,
.sheet__nav-button:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.35);
}

.sheet__body {
    display: flex;
    flex-direction: column;
}
</style>
