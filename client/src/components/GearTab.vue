<template>
    <section class="panel">
        <header class="panel__header">
            <h3 class="panel__title">Gear loadout</h3>
        </header>
        <div v-if="!slots.length" class="panel__placeholder">No gear configured.</div>
        <ul v-else class="panel__grid">
            <li v-for="slot in slots" :key="slot.key" class="panel__gear-slot">
                <h4>{{ slot.label }}</h4>
                <p v-if="slot.item" class="panel__gear-name">{{ slot.item.name }}</p>
                <p v-else class="panel__gear-empty">Empty slot</p>
            </li>
        </ul>
    </section>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
    game: { type: Object, required: true },
    me: { type: Object, default: null },
});

const slots = computed(() => {
    const gear = props.game?.gear || {};
    return Object.entries(gear).map(([key, item]) => ({
        key,
        label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
        item: item && typeof item === 'object' ? item : null,
    }));
});
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

.panel__grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
}

.panel__gear-slot {
    background: rgba(12, 15, 30, 0.6);
    border-radius: 0.9rem;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}

.panel__gear-slot h4 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
}

.panel__gear-name {
    margin: 0;
}

.panel__gear-empty {
    margin: 0;
    color: rgba(255, 255, 255, 0.6);
}

.panel__placeholder {
    color: rgba(255, 255, 255, 0.6);
}
</style>
