<template>
    <section class="panel">
        <header class="panel__header">
            <h3 class="panel__title">Server management</h3>
            <div class="panel__actions">
                <button type="button" class="button button--small" @click="refreshActive">Refresh game</button>
                <button type="button" class="button button--small" @click="refreshGames">Refresh campaigns</button>
            </div>
        </header>
        <p class="panel__placeholder">Administrative tools are limited in this simplified interface.</p>
    </section>
</template>

<script setup>
const props = defineProps({
    activeGameId: { type: String, default: null },
    onRefreshActiveGame: { type: Function, default: null },
    onRefreshGames: { type: Function, default: null },
});

function refreshActive() {
    props.onRefreshActiveGame?.(props.activeGameId);
}

function refreshGames() {
    props.onRefreshGames?.();
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

.panel__actions {
    display: flex;
    gap: 0.5rem;
}

.panel__placeholder {
    color: rgba(255, 255, 255, 0.65);
}

.button {
    border: none;
    border-radius: 999px;
    padding: 0.45rem 0.9rem;
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;
}

.button--small {
    font-size: 0.8rem;
}
</style>
