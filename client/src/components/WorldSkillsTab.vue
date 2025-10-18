<template>
    <section class="panel">
        <header class="panel__header">
            <h3 class="panel__title">World skills</h3>
        </header>
        <p v-if="!skills.length" class="panel__placeholder">No skills recorded.</p>
        <table v-else class="skills-table">
            <thead>
                <tr>
                    <th scope="col">Skill</th>
                    <th scope="col">Rank</th>
                    <th scope="col">Modifier</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="skill in skills" :key="skill.id || skill.name">
                    <th scope="row">{{ skill.name }}</th>
                    <td>{{ skill.rank ?? '—' }}</td>
                    <td>{{ formatModifier(skill.modifier) }}</td>
                </tr>
            </tbody>
        </table>
    </section>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
    game: { type: Object, required: true },
    me: { type: Object, default: null },
});

const skills = computed(() => {
    const list = props.game?.worldSkills;
    if (Array.isArray(list)) return list;
    if (list && typeof list === 'object') return Object.values(list);
    return [];
});

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
