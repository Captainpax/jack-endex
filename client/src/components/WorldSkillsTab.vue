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
        <WorldSkillsSheetPane :game="game" :player="activePlayer" />
    </section>
</template>

<script setup>
import { toRef } from 'vue';

import { useSheetPlayerContext } from '../composables/useSheetPlayerContext';
import WorldSkillsSheetPane from './sheet/WorldSkillsSheetPane.vue';

const props = defineProps({
    game: { type: Object, required: true },
    me: { type: Object, default: null },
});

const { isDM, playerOptions, selectedPlayerKey, activePlayer } = useSheetPlayerContext({
    game: toRef(props, 'game'),
    me: toRef(props, 'me'),
});

const game = toRef(props, 'game');
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
</style>
