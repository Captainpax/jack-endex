<template>
    <section class="panel">
        <header class="panel__header">
            <h3 class="panel__title">Demon companions</h3>
        </header>
        <p v-if="!demons.length" class="panel__placeholder">No demons summoned.</p>
        <div v-else class="demon-grid">
            <article v-for="demon in demons" :key="demon.id || demon.name" class="demon-card">
                <DemonImage :src="demon.image" :name="demon.name" :caption="demon.archetype" />
                <div class="demon-card__body">
                    <h4>{{ demon.name }}</h4>
                    <p v-if="demon.role" class="demon-card__meta">{{ demon.role }}</p>
                    <p v-if="demon.description" class="demon-card__desc">{{ demon.description }}</p>
                </div>
            </article>
        </div>
    </section>
</template>

<script setup>
import { computed } from 'vue';
import DemonImage from './DemonImage.vue';

const props = defineProps({
    game: { type: Object, required: true },
    me: { type: Object, default: null },
});

const demons = computed(() => {
    const list = props.game?.demons;
    if (Array.isArray(list)) return list;
    if (list && typeof list === 'object') return Object.values(list);
    return [];
});
</script>

<style scoped>
.panel {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
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

.demon-grid {
    display: grid;
    gap: 1.25rem;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.demon-card {
    background: rgba(12, 15, 30, 0.6);
    border-radius: 1rem;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.demon-card__body h4 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
}

.demon-card__meta {
    margin: 0;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.65);
}

.demon-card__desc {
    margin: 0.5rem 0 0;
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.75);
}

.panel__placeholder {
    color: rgba(255, 255, 255, 0.6);
}
</style>
