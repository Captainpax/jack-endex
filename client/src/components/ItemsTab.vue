<template>
    <section class="panel">
        <header class="panel__header">
            <h3 class="panel__title">Items library</h3>
            <button type="button" class="button button--small" @click="refresh">Refresh</button>
        </header>
        <p v-if="!items.length" class="panel__placeholder">No items found for this campaign.</p>
        <ul v-else class="panel__list">
            <li v-for="item in items" :key="item.id || item.name" class="panel__list-item">
                <strong>{{ item.name || 'Unnamed item' }}</strong>
                <span v-if="item.type" class="panel__meta">{{ item.type }}</span>
                <p v-if="item.description" class="panel__desc">{{ item.description }}</p>
            </li>
        </ul>
    </section>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
    game: { type: Object, required: true },
    me: { type: Object, default: null },
    realtime: { type: Object, default: null },
});

const emit = defineEmits(['update']);

const items = computed(() => {
    const playerItems = props.game?.items;
    if (Array.isArray(playerItems)) return playerItems;
    if (playerItems && typeof playerItems === 'object') {
        return Object.values(playerItems).flat().filter(Boolean);
    }
    return [];
});

function refresh() {
    emit('update');
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

.panel__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.panel__list-item {
    padding: 0.75rem 1rem;
    border-radius: 0.85rem;
    background: rgba(12, 15, 30, 0.6);
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}

.panel__meta {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.6);
}

.panel__desc {
    margin: 0;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.7);
}

.panel__placeholder {
    color: rgba(255, 255, 255, 0.6);
}

.button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: none;
    border-radius: 999px;
    padding: 0.45rem 0.85rem;
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;
}

.button--small {
    font-size: 0.8rem;
}
</style>
