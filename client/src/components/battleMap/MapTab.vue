<template>
    <section class="panel">
        <header class="panel__header">
            <h3 class="panel__title">Battle map</h3>
            <button type="button" class="button button--small" @click="logRefresh">Log sync</button>
        </header>
        <div class="map-canvas">
            <p v-if="!mapStrokes.length" class="panel__placeholder">No map data yet.</p>
            <ul v-else class="map-strokes">
                <li v-for="stroke in mapStrokes" :key="stroke.id" class="map-stroke">
                    <span class="map-stroke__color" :style="{ backgroundColor: stroke.color || '#5aadff' }"></span>
                    <span class="map-stroke__label">Stroke {{ stroke.id }}</span>
                    <span class="map-stroke__meta">{{ stroke.points?.length || 0 }} points</span>
                </li>
            </ul>
        </div>
    </section>
</template>

<script setup>
import { computed } from 'vue';
import { useBattleLogger } from '../../composables/useBattleLogger';

const props = defineProps({
    game: { type: Object, required: true },
    me: { type: Object, default: null },
    logger: { type: Function, default: null },
    realtime: { type: Object, default: null },
});

const mapStrokes = computed(() => {
    const map = props.game?.map;
    if (map?.strokes && Array.isArray(map.strokes)) return map.strokes;
    return [];
});

const log = props.logger || useBattleLogger(() => props.game?.id);

function logRefresh() {
    const id = props.game?.id;
    if (!id) return;
    log('map_refresh', `Viewed map for game ${id}`);
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

.map-canvas {
    min-height: 240px;
    border-radius: 1rem;
    background: rgba(12, 15, 30, 0.6);
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.map-strokes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.map-stroke {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.75rem;
    background: rgba(0, 0, 0, 0.25);
}

.map-stroke__color {
    width: 1rem;
    height: 1rem;
    border-radius: 0.5rem;
}

.map-stroke__label {
    font-weight: 600;
}

.map-stroke__meta {
    margin-left: auto;
    color: rgba(255, 255, 255, 0.6);
}

.button {
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
