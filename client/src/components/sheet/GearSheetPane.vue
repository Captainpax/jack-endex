<template>
    <div class="gear-pane">
        <p v-if="!player" class="gear-pane__placeholder">{{ emptyPlayerText }}</p>
        <template v-else>
            <p v-if="!hasSlots" class="gear-pane__placeholder">{{ emptyGearText }}</p>
            <ul v-else class="gear-pane__grid">
                <li v-for="slot in slots" :key="slot.key" class="gear-pane__slot">
                    <header class="gear-pane__slot-header">
                        <h4 class="gear-pane__slot-label">{{ slot.label }}</h4>
                        <span v-if="slot.item?.type" class="gear-pane__slot-type">{{ slot.item.type }}</span>
                    </header>
                    <p v-if="slot.item" class="gear-pane__slot-name">{{ slot.item.name }}</p>
                    <p v-else class="gear-pane__slot-empty">Empty slot</p>
                    <p v-if="slot.item?.description" class="gear-pane__slot-desc">{{ slot.item.description }}</p>
                    <dl
                        v-if="slot.item && (slot.item.libraryItemId || slot.item.quantity !== null)"
                        class="gear-pane__slot-meta"
                    >
                        <div v-if="slot.item.libraryItemId" class="gear-pane__slot-meta-row">
                            <dt>Library ID</dt>
                            <dd>{{ slot.item.libraryItemId }}</dd>
                        </div>
                        <div v-if="slot.item.quantity !== null" class="gear-pane__slot-meta-row">
                            <dt>Quantity</dt>
                            <dd>{{ slot.item.quantity }}</dd>
                        </div>
                    </dl>
                </li>
            </ul>
            <section v-if="bagItems.length" class="gear-pane__bag">
                <header class="gear-pane__bag-header">
                    <h4 class="gear-pane__bag-title">{{ bagTitle }}</h4>
                    <span class="gear-pane__bag-count">
                        {{ bagItems.length }} {{ bagItems.length === 1 ? 'item' : 'items' }}
                    </span>
                </header>
                <ul class="gear-pane__bag-list">
                    <li v-for="item in bagItems" :key="item.id || item.name" class="gear-pane__bag-item">
                        <div class="gear-pane__bag-item-main">
                            <span class="gear-pane__bag-item-name">{{ item.name }}</span>
                            <span v-if="item.type" class="gear-pane__bag-item-type">{{ item.type }}</span>
                        </div>
                        <p v-if="item.description" class="gear-pane__bag-item-desc">{{ item.description }}</p>
                        <dl v-if="item.libraryItemId || item.quantity !== null" class="gear-pane__bag-item-meta">
                            <div v-if="item.libraryItemId" class="gear-pane__bag-item-meta-row">
                                <dt>Library ID</dt>
                                <dd>{{ item.libraryItemId }}</dd>
                            </div>
                            <div v-if="item.quantity !== null" class="gear-pane__bag-item-meta-row">
                                <dt>Quantity</dt>
                                <dd>{{ item.quantity }}</dd>
                            </div>
                        </dl>
                    </li>
                </ul>
            </section>
        </template>
    </div>
</template>

<script setup>
import { computed, toRef } from 'vue';

const props = defineProps({
    player: { type: Object, default: null },
    emptyPlayerText: { type: String, default: 'No player selected.' },
    emptyGearText: { type: String, default: 'No gear configured.' },
    bagTitle: { type: String, default: 'Bag' },
});

const playerRef = toRef(props, 'player');

const GEAR_SLOTS = [
    'weapon',
    'armor',
    'accessory',
    'slot4',
    'slot5',
    'slot6',
    'slot7',
    'slot8',
    'slot9',
    'slot10',
];

const gear = computed(() => playerRef.value?.gear || null);

const bagItems = computed(() => {
    const bag = Array.isArray(gear.value?.bag) ? gear.value.bag : [];
    return bag
        .map((item) => normalizeGearItem(item))
        .filter((item) => item !== null)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
});

const bagItemMap = computed(() => {
    const map = new Map();
    for (const item of bagItems.value) {
        if (item.id && !map.has(item.id)) {
            map.set(item.id, item);
        }
    }
    return map;
});

const slots = computed(() => {
    const rawSlots = gear.value && typeof gear.value.slots === 'object' ? gear.value.slots : {};
    const entries = [];

    for (const slotKey of GEAR_SLOTS) {
        const slotSource = rawSlots?.[slotKey] ?? null;
        const resolved = resolveSlotItem(slotSource, bagItemMap.value);
        entries.push({
            key: slotKey,
            label: formatSlotLabel(slotKey),
            item: resolved,
        });
    }

    const extraEntries = Object.keys(rawSlots || {})
        .filter((key) => !GEAR_SLOTS.includes(key))
        .map((key) => ({
            key,
            label: formatSlotLabel(key),
            item: resolveSlotItem(rawSlots[key], bagItemMap.value),
        }));

    return [...entries, ...extraEntries];
});

const hasSlots = computed(() => slots.value.length > 0);

function resolveSlotItem(source, bagMap) {
    if (!source) return null;
    if (source && typeof source === 'object') {
        const rawItemId = typeof source.itemId === 'string' ? source.itemId : null;
        if (rawItemId && bagMap.has(rawItemId)) {
            return bagMap.get(rawItemId);
        }

        if (rawItemId && source.item && typeof source.item === 'object') {
            const normalized = normalizeGearItem({ ...source.item, id: rawItemId });
            if (normalized) return normalized;
        }

        const fallback = normalizeGearItem(source.item || source);
        if (fallback) return fallback;
    }

    return null;
}

function formatSlotLabel(key) {
    if (!key) return 'Gear';
    const normalized = String(key).trim();
    const slotMatch = normalized.match(/^slot(\d+)$/i);
    if (slotMatch) return `Slot ${slotMatch[1]}`;
    return normalized
        .replace(/[-_]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/^./, (char) => char.toUpperCase());
}

function normalizeGearItem(item) {
    if (!item || typeof item !== 'object') return null;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const type = typeof item.type === 'string' ? item.type.trim() : '';
    const desc = typeof item.desc === 'string' ? item.desc.trim() : '';
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    const libraryItemId = typeof item.libraryItemId === 'string' ? item.libraryItemId.trim() : '';
    const amount = Number(item.amount);
    const quantity = Number.isFinite(amount) && amount > 0 ? Math.round(amount) : null;
    const id = typeof item.id === 'string' && item.id ? item.id : null;

    if (!name && !type && !desc && !description && !libraryItemId && quantity === null) {
        return null;
    }

    return {
        id,
        name: name || 'Unnamed item',
        type,
        description: desc || description,
        libraryItemId: libraryItemId || null,
        quantity,
    };
}
</script>

<style scoped>
.gear-pane {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.gear-pane__placeholder {
    margin: 0;
    color: rgba(255, 255, 255, 0.6);
}

.gear-pane__grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
}

.gear-pane__slot {
    background: rgba(12, 15, 30, 0.6);
    border-radius: 0.9rem;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}

.gear-pane__slot-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
}

.gear-pane__slot-label {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
}

.gear-pane__slot-type {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.7);
}

.gear-pane__slot-name {
    margin: 0;
    font-weight: 600;
}

.gear-pane__slot-empty {
    margin: 0;
    color: rgba(255, 255, 255, 0.6);
}

.gear-pane__slot-desc {
    margin: 0;
    color: rgba(255, 255, 255, 0.75);
}

.gear-pane__slot-meta {
    margin: 0;
    display: grid;
    gap: 0.25rem;
}

.gear-pane__slot-meta-row {
    display: flex;
    gap: 0.5rem;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.75);
}

.gear-pane__slot-meta-row dt {
    font-weight: 600;
}

.gear-pane__slot-meta-row dd {
    margin: 0;
}

.gear-pane__bag {
    background: rgba(12, 15, 30, 0.45);
    border-radius: 0.9rem;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.gear-pane__bag-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
}

.gear-pane__bag-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
}

.gear-pane__bag-count {
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.7);
}

.gear-pane__bag-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.gear-pane__bag-item {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}

.gear-pane__bag-item-main {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
}

.gear-pane__bag-item-name {
    font-weight: 600;
}

.gear-pane__bag-item-type {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.7);
}

.gear-pane__bag-item-desc {
    margin: 0;
    color: rgba(255, 255, 255, 0.75);
}

.gear-pane__bag-item-meta {
    margin: 0;
    display: grid;
    gap: 0.25rem;
}

.gear-pane__bag-item-meta-row {
    display: flex;
    gap: 0.5rem;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.75);
}

.gear-pane__bag-item-meta-row dt {
    font-weight: 600;
}

.gear-pane__bag-item-meta-row dd {
    margin: 0;
}
</style>
