<template>
    <aside class="map-sidebar">
        <section
            v-for="panel in normalizedPanels"
            :key="panel.id"
            class="map-sidebar__panel"
            :class="{ 'is-open': panel.isOpen }"
        >
            <header class="map-sidebar__panel-header">
                <button
                    type="button"
                    class="map-sidebar__panel-toggle"
                    @click="togglePanel(panel.id)"
                    :aria-expanded="panel.isOpen"
                    :aria-controls="`${panel.id}-content`"
                >
                    <span class="map-sidebar__panel-title">{{ panel.title }}</span>
                    <span class="map-sidebar__panel-icon" aria-hidden="true"></span>
                </button>
                <p v-if="panel.description" class="map-sidebar__panel-description">{{ panel.description }}</p>
            </header>
            <div
                v-show="panel.isOpen"
                class="map-sidebar__panel-body"
                role="region"
                :id="`${panel.id}-content`"
            >
                <slot :name="panel.slot || panel.id" />
            </div>
        </section>
    </aside>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({
    panels: {
        type: Array,
        default: () => [],
    },
});

const openPanels = ref(new Set());

const togglePanel = (panelId) => {
    const next = new Set(openPanels.value);
    if (next.has(panelId)) {
        next.delete(panelId);
    } else {
        next.add(panelId);
    }
    openPanels.value = next;
};

watch(
    () => props.panels,
    (panels) => {
        const next = new Set(openPanels.value);
        const validIds = new Set();
        panels.forEach((panel) => {
            validIds.add(panel.id);
            if (panel.defaultOpen && !next.has(panel.id)) {
                next.add(panel.id);
            }
        });
        Array.from(next).forEach((id) => {
            if (!validIds.has(id)) {
                next.delete(id);
            }
        });
        openPanels.value = new Set(next);
    },
    { immediate: true, deep: true }
);

const normalizedPanels = computed(() =>
    props.panels.map((panel) => ({
        ...panel,
        isOpen: openPanels.value.has(panel.id),
    }))
);
</script>
