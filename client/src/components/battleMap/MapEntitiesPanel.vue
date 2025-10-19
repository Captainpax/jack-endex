<template>
    <section
        class="map-entities-panel"
        @mouseleave="emit('clear-highlight')"
        @focusout="onPanelFocusOut"
    >
        <header class="map-entities-panel__header">
            <div>
                <h3 class="map-entities-panel__title">Map entities</h3>
                <p class="map-entities-panel__description">
                    Browse and manage tokens, shapes, and saved drawings.
                </p>
            </div>
            <span class="map-entities-panel__badge">{{ totalEntityCount }} items</span>
        </header>

        <div class="map-entities-panel__search">
            <label for="map-entities-search" class="map-entities-panel__search-label">Search</label>
            <div class="map-entities-panel__search-control">
                <input
                    id="map-entities-search"
                    v-model="searchTerm"
                    type="search"
                    class="map-entities-panel__search-input"
                    placeholder="Filter by name, type, or notes"
                    spellcheck="false"
                />
                <button
                    v-if="searchTerm"
                    type="button"
                    class="map-entities-panel__search-clear"
                    @click="searchTerm = ''"
                >
                    <span class="sr-only">Clear search</span>
                    ×
                </button>
            </div>
        </div>

        <CollapsibleSection :default-expanded="true" class="map-entities-panel__section">
            <template #header>
                <div class="map-entities-panel__section-header">
                    <span>Tokens</span>
                    <span class="map-entities-panel__count">{{ filteredTokenCount }}</span>
                </div>
            </template>
            <template #body>
                <div v-if="!tokenGroups.length" class="map-entities-panel__empty">No tokens found.</div>
                <div v-else class="map-entities-panel__groups">
                    <div
                        v-for="group in tokenGroups"
                        :key="`token-${group.id}`"
                        class="map-entities-panel__group"
                    >
                        <button
                            type="button"
                            class="map-entities-panel__group-toggle"
                            :aria-expanded="isOpen(group.key)"
                            @click="toggleGroup(group.key)"
                        >
                            <span>{{ group.label }}</span>
                            <span class="map-entities-panel__count">{{ group.items.length }}</span>
                        </button>
                        <ul v-show="isOpen(group.key)" class="map-entities-panel__items">
                            <li
                                v-for="token in group.items"
                                :key="token.id"
                                class="map-entities-panel__item"
                                @mouseenter="emit('highlight-token', token.id)"
                                @focusin="emit('highlight-token', token.id)"
                            >
                                <div class="map-entities-panel__item-main">
                                    <span class="map-entities-panel__item-label">{{ token.label || 'Token' }}</span>
                                    <span class="map-entities-panel__item-meta">{{ describeToken(token) }}</span>
                                </div>
                                <div class="map-entities-panel__item-actions">
                                    <button
                                        type="button"
                                        class="map-entities-panel__action"
                                        @click="emit('focus-token', token.id)"
                                    >
                                        Focus
                                    </button>
                                    <button
                                        type="button"
                                        class="map-entities-panel__action"
                                        @click="emit('toggle-token-tooltip', token.id)"
                                    >
                                        {{ token.showTooltip ? 'Hide tip' : 'Show tip' }}
                                    </button>
                                </div>
                            </li>
                        </ul>
                    </div>
                </div>
            </template>
        </CollapsibleSection>

        <CollapsibleSection :default-expanded="false" class="map-entities-panel__section">
            <template #header>
                <div class="map-entities-panel__section-header">
                    <span>Shapes</span>
                    <span class="map-entities-panel__count">{{ filteredShapeCount }}</span>
                </div>
            </template>
            <template #body>
                <div v-if="!shapeGroups.length" class="map-entities-panel__empty">No shapes found.</div>
                <div v-else class="map-entities-panel__groups">
                    <div
                        v-for="group in shapeGroups"
                        :key="`shape-${group.id}`"
                        class="map-entities-panel__group"
                    >
                        <button
                            type="button"
                            class="map-entities-panel__group-toggle"
                            :aria-expanded="isOpen(group.key)"
                            @click="toggleGroup(group.key)"
                        >
                            <span>{{ group.label }}</span>
                            <span class="map-entities-panel__count">{{ group.items.length }}</span>
                        </button>
                        <ul v-show="isOpen(group.key)" class="map-entities-panel__items">
                            <li
                                v-for="shape in group.items"
                                :key="shape.id"
                                class="map-entities-panel__item"
                                @mouseenter="emit('highlight-shape', shape.id)"
                                @focusin="emit('highlight-shape', shape.id)"
                            >
                                <div class="map-entities-panel__item-main">
                                    <span class="map-entities-panel__item-label">{{ describeShape(shape) }}</span>
                                    <span class="map-entities-panel__item-meta">{{ shapeSummary(shape) }}</span>
                                </div>
                                <div class="map-entities-panel__item-actions">
                                    <button
                                        type="button"
                                        class="map-entities-panel__action"
                                        @click="emit('focus-shape', shape.id)"
                                    >
                                        Focus
                                    </button>
                                </div>
                            </li>
                        </ul>
                    </div>
                </div>
            </template>
        </CollapsibleSection>

        <CollapsibleSection :default-expanded="false" class="map-entities-panel__section">
            <template #header>
                <div class="map-entities-panel__section-header">
                    <span>Saved drawings</span>
                    <span class="map-entities-panel__count">{{ filteredStrokeCount }}</span>
                </div>
            </template>
            <template #body>
                <div v-if="!strokeGroups.length" class="map-entities-panel__empty">No saved drawings.</div>
                <div v-else class="map-entities-panel__groups">
                    <div
                        v-for="group in strokeGroups"
                        :key="`stroke-${group.id}`"
                        class="map-entities-panel__group"
                    >
                        <button
                            type="button"
                            class="map-entities-panel__group-toggle"
                            :aria-expanded="isOpen(group.key)"
                            @click="toggleGroup(group.key)"
                        >
                            <span>{{ group.label }}</span>
                            <span class="map-entities-panel__count">{{ group.items.length }}</span>
                        </button>
                        <ul v-show="isOpen(group.key)" class="map-entities-panel__items">
                            <li
                                v-for="stroke in group.items"
                                :key="stroke.id"
                                class="map-entities-panel__item"
                                @mouseenter="emit('highlight-stroke', stroke.id)"
                                @focusin="emit('highlight-stroke', stroke.id)"
                            >
                                <div class="map-entities-panel__item-main">
                                    <span class="map-entities-panel__item-label">{{ describeStroke(stroke) }}</span>
                                    <span class="map-entities-panel__item-meta">{{ strokeSummary(stroke) }}</span>
                                </div>
                                <div class="map-entities-panel__item-actions">
                                    <button
                                        type="button"
                                        class="map-entities-panel__action"
                                        @click="emit('focus-stroke', stroke.id)"
                                    >
                                        Focus
                                    </button>
                                </div>
                            </li>
                        </ul>
                    </div>
                </div>
            </template>
        </CollapsibleSection>
    </section>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { CollapsibleSection } from '../ui';

const props = defineProps({
    mapState: {
        type: Object,
        required: true,
    },
});

const emit = defineEmits([
    'focus-token',
    'toggle-token-tooltip',
    'focus-shape',
    'focus-stroke',
    'highlight-token',
    'highlight-shape',
    'highlight-stroke',
    'clear-highlight',
]);

const onPanelFocusOut = (event) => {
    if (!event?.currentTarget) return;
    const next = event.relatedTarget;
    if (!next || !event.currentTarget.contains(next)) {
        emit('clear-highlight');
    }
};

const searchTerm = ref('');
const openGroups = reactive(new Set());

const tokenGroupDefinitions = [
    {
        id: 'players',
        key: 'token:players',
        label: 'Players',
        matcher: (token) => token.kind === 'player',
    },
    {
        id: 'npcs',
        key: 'token:npcs',
        label: 'NPCs',
        matcher: (token) => token.kind === 'npc',
    },
    {
        id: 'enemies',
        key: 'token:enemies',
        label: 'Enemies',
        matcher: (token) => token.kind === 'enemy' || token.kind === 'demon',
    },
    {
        id: 'hazards',
        key: 'token:hazards',
        label: 'Hazards',
        matcher: (token) => ['hazard', 'trap', 'environment'].includes(token.kind),
    },
    {
        id: 'others',
        key: 'token:others',
        label: 'Other tokens',
        matcher: () => true,
    },
];

const shapeGroupDefinitions = [
    {
        id: 'areas',
        key: 'shape:areas',
        label: 'Areas & templates',
        matcher: (shape) => ['rectangle', 'circle', 'diamond'].includes(shape.type),
    },
    {
        id: 'lines',
        key: 'shape:lines',
        label: 'Lines & rulers',
        matcher: (shape) => shape.type === 'line',
    },
    {
        id: 'images',
        key: 'shape:images',
        label: 'Image overlays',
        matcher: (shape) => shape.type === 'image',
    },
    {
        id: 'other',
        key: 'shape:other',
        label: 'Other shapes',
        matcher: () => true,
    },
];

const strokeGroupDefinitions = [
    {
        id: 'draw',
        key: 'stroke:draw',
        label: 'Brush strokes',
        matcher: (stroke) => stroke.mode !== 'erase',
    },
    {
        id: 'erase',
        key: 'stroke:erase',
        label: 'Erasures',
        matcher: (stroke) => stroke.mode === 'erase',
    },
];

tokenGroupDefinitions.forEach((definition) => openGroups.add(definition.key));
shapeGroupDefinitions.forEach((definition) => openGroups.add(definition.key));
strokeGroupDefinitions.forEach((definition) => openGroups.add(definition.key));

const normalizedSearch = computed(() => searchTerm.value.trim().toLowerCase());

const filteredTokens = computed(() => {
    const tokens = Array.isArray(props.mapState?.tokens) ? props.mapState.tokens : [];
    const query = normalizedSearch.value;
    if (!query) return tokens;
    return tokens.filter((token) => matchesTokenSearch(token, query));
});

const filteredShapes = computed(() => {
    const shapes = Array.isArray(props.mapState?.shapes) ? props.mapState.shapes : [];
    const query = normalizedSearch.value;
    if (!query) return shapes;
    return shapes.filter((shape) => matchesShapeSearch(shape, query));
});

const filteredStrokes = computed(() => {
    const strokes = Array.isArray(props.mapState?.strokes) ? props.mapState.strokes : [];
    const query = normalizedSearch.value;
    if (!query) return strokes;
    return strokes.filter((stroke) => matchesStrokeSearch(stroke, query));
});

const tokenGroups = computed(() => groupEntities(filteredTokens.value, tokenGroupDefinitions));
const shapeGroups = computed(() => groupEntities(filteredShapes.value, shapeGroupDefinitions));
const strokeGroups = computed(() => groupEntities(filteredStrokes.value, strokeGroupDefinitions));

const filteredTokenCount = computed(() => filteredTokens.value.length);
const filteredShapeCount = computed(() => filteredShapes.value.length);
const filteredStrokeCount = computed(() => filteredStrokes.value.length);

const totalEntityCount = computed(
    () => filteredTokenCount.value + filteredShapeCount.value + filteredStrokeCount.value
);

function groupEntities(items, definitions) {
    const groups = definitions.map((definition) => ({ ...definition, items: [] }));
    for (const item of items) {
        const group = groups.find((candidate) => candidate.matcher(item));
        if (group) {
            group.items.push(item);
        }
    }
    return groups.filter((group) => group.items.length > 0);
}

function isOpen(key) {
    return openGroups.has(key);
}

function toggleGroup(key) {
    if (openGroups.has(key)) {
        openGroups.delete(key);
    } else {
        openGroups.add(key);
    }
}

function matchesTokenSearch(token, query) {
    if (!token) return false;
    const fields = [token.label, token.tooltip, token.kind, token.id, token.refId];
    return fields.some((field) => typeof field === 'string' && field.toLowerCase().includes(query));
}

function matchesShapeSearch(shape, query) {
    if (!shape) return false;
    const fields = [shape.type, shape.id];
    return fields.some((field) => typeof field === 'string' && field.toLowerCase().includes(query));
}

function matchesStrokeSearch(stroke, query) {
    if (!stroke) return false;
    const fields = [stroke.id, stroke.mode, stroke.color];
    return fields.some((field) => typeof field === 'string' && field.toLowerCase().includes(query));
}

function describeToken(token) {
    const parts = [];
    if (token.kind) parts.push(token.kind);
    if (token.tooltip) parts.push(token.tooltip.slice(0, 42));
    return parts.join(' · ');
}

function describeShape(shape) {
    if (!shape) return 'Shape';
    if (shape.type === 'image') return 'Image overlay';
    if (shape.type === 'line') return 'Measurement';
    return `${capitalize(shape.type)} shape`;
}

function shapeSummary(shape) {
    if (!shape) return '';
    const width = Math.round((shape.width || 0) * 100);
    const height = Math.round((shape.height || 0) * 100);
    if (shape.type === 'line') {
        return `${width} × ${height}`;
    }
    return `${width}% × ${height}% @ (${Math.round((shape.x || 0) * 100)}%, ${Math.round(
        (shape.y || 0) * 100
    )}%)`;
}

function describeStroke(stroke) {
    if (!stroke) return 'Drawing';
    return stroke.mode === 'erase' ? 'Eraser stroke' : 'Brush stroke';
}

function strokeSummary(stroke) {
    if (!stroke) return '';
    const color = stroke.color || '#5aadff';
    const points = Array.isArray(stroke.points) ? stroke.points.length : 0;
    return `${stroke.mode === 'erase' ? 'Erase' : 'Draw'} · ${points} points · ${color}`;
}

function capitalize(value) {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
}
</script>

<style scoped>
.map-entities-panel {
    display: grid;
    gap: 16px;
}

.map-entities-panel__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
}

.map-entities-panel__title {
    font-size: 1.1rem;
    margin: 0;
}

.map-entities-panel__description {
    margin: 4px 0 0;
    color: rgba(148, 163, 184, 0.95);
    font-size: 0.85rem;
}

.map-entities-panel__badge {
    align-self: flex-start;
    background: rgba(148, 163, 184, 0.15);
    color: rgba(148, 163, 184, 0.9);
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 0.75rem;
    font-weight: 600;
}

.map-entities-panel__search {
    display: grid;
    gap: 6px;
}

.map-entities-panel__search-label {
    font-size: 0.8rem;
    color: rgba(148, 163, 184, 0.95);
}

.map-entities-panel__search-control {
    position: relative;
}

.map-entities-panel__search-input {
    width: 100%;
    border-radius: var(--radius);
    border: 1px solid rgba(71, 85, 105, 0.6);
    background: rgba(15, 23, 42, 0.65);
    color: #e2e8f0;
    padding: 8px 32px 8px 10px;
    font-size: 0.85rem;
}

.map-entities-panel__search-input:focus {
    outline: 2px solid rgba(96, 165, 250, 0.6);
    outline-offset: 2px;
}

.map-entities-panel__search-clear {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    color: rgba(148, 163, 184, 0.95);
    font-size: 1rem;
    cursor: pointer;
    line-height: 1;
}

.map-entities-panel__section {
    border: 1px solid rgba(71, 85, 105, 0.45);
    border-radius: var(--radius);
    background: rgba(15, 23, 42, 0.35);
}

.map-entities-panel__section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
}

.map-entities-panel__groups {
    display: grid;
    gap: 8px;
}

.map-entities-panel__group {
    border: 1px solid rgba(71, 85, 105, 0.25);
    border-radius: calc(var(--radius) - 4px);
    background: rgba(15, 23, 42, 0.45);
}

.map-entities-panel__group-toggle {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: transparent;
    border: none;
    color: inherit;
    padding: 8px 12px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
}

.map-entities-panel__items {
    list-style: none;
    margin: 0;
    padding: 0 0 8px;
    display: grid;
    gap: 4px;
}

.map-entities-panel__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 12px;
    border-top: 1px solid rgba(71, 85, 105, 0.2);
}

.map-entities-panel__item-main {
    display: grid;
    gap: 2px;
}

.map-entities-panel__item-label {
    font-size: 0.85rem;
    font-weight: 600;
}

.map-entities-panel__item-meta {
    font-size: 0.75rem;
    color: rgba(148, 163, 184, 0.85);
}

.map-entities-panel__item-actions {
    display: flex;
    gap: 6px;
}

.map-entities-panel__action {
    background: rgba(59, 130, 246, 0.08);
    border: 1px solid rgba(59, 130, 246, 0.35);
    color: #bfdbfe;
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 0.75rem;
    cursor: pointer;
}

.map-entities-panel__action:hover,
.map-entities-panel__action:focus {
    background: rgba(59, 130, 246, 0.2);
}

.map-entities-panel__count {
    font-size: 0.75rem;
    background: rgba(30, 64, 175, 0.2);
    color: rgba(165, 180, 252, 0.9);
    border-radius: 999px;
    padding: 2px 6px;
}

.map-entities-panel__empty {
    padding: 8px 12px;
    font-size: 0.8rem;
    color: rgba(148, 163, 184, 0.85);
}

.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
}
</style>
