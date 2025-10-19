<template>
    <header class="map-header">
        <div class="map-header__info">
            <h3 class="map-header__title">Battle map</h3>
            <p class="map-header__meta" v-if="updatedAtLabel">
                Last updated {{ updatedAtLabel }}
            </p>
        </div>
        <div class="map-header__actions">
            <button type="button" class="btn secondary" :disabled="syncBusy" @click="emit('sync')">
                <span v-if="syncBusy">Syncing…</span>
                <span v-else>Sync map</span>
            </button>
        </div>
    </header>
</template>

<script setup>
const props = defineProps({
    updatedAtLabel: { type: String, default: '' },
    syncBusy: { type: Boolean, default: false },
});

const emit = defineEmits(['sync']);
</script>
