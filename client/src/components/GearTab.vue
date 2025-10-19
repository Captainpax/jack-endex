<template>
    <section class="panel">
        <header class="panel__header">
            <h3 class="panel__title">Gear loadout</h3>
            <label v-if="isDM && playerOptions.length" class="panel__picker">
                <span class="sr-only">Inspect player</span>
                <select v-model="selectedPlayerKey" class="panel__picker-select">
                    <option v-for="option in playerOptions" :key="option.key" :value="option.key">
                        {{ option.label }}
                    </option>
                </select>
            </label>
        </header>
        <p v-if="!activePlayer" class="panel__placeholder">No player selected.</p>
        <p v-else-if="!hasSlots" class="panel__placeholder">No gear configured.</p>
        <ul v-else class="panel__grid">
            <li v-for="slot in slots" :key="slot.key" class="panel__gear-slot">
                <header class="panel__gear-slot-header">
                    <h4 class="panel__gear-slot-label">{{ slot.label }}</h4>
                    <span v-if="slot.item?.type" class="panel__gear-type">{{ slot.item.type }}</span>
                </header>
                <p v-if="slot.item" class="panel__gear-name">{{ slot.item.name }}</p>
                <p v-else class="panel__gear-empty">Empty slot</p>
                <p v-if="slot.item?.description" class="panel__gear-desc">{{ slot.item.description }}</p>
                <dl
                    v-if="slot.item && (slot.item.libraryItemId || slot.item.quantity !== null)"
                    class="panel__gear-meta"
                >
                    <div v-if="slot.item.libraryItemId" class="panel__gear-meta-row">
                        <dt>Library ID</dt>
                        <dd>{{ slot.item.libraryItemId }}</dd>
                    </div>
                    <div v-if="slot.item.quantity !== null" class="panel__gear-meta-row">
                        <dt>Quantity</dt>
                        <dd>{{ slot.item.quantity }}</dd>
                    </div>
                </dl>
            </li>
        </ul>
        <section v-if="bagItems.length" class="panel__bag">
            <header class="panel__bag-header">
                <h4 class="panel__bag-title">Bag</h4>
                <span class="panel__bag-count">
                    {{ bagItems.length }} {{ bagItems.length === 1 ? 'item' : 'items' }}
                </span>
            </header>
            <ul class="panel__bag-list">
                <li v-for="item in bagItems" :key="item.id || item.name" class="panel__bag-item">
                    <div class="panel__bag-item-main">
                        <span class="panel__bag-item-name">{{ item.name }}</span>
                        <span v-if="item.type" class="panel__bag-item-type">{{ item.type }}</span>
                    </div>
                    <p v-if="item.description" class="panel__bag-item-desc">{{ item.description }}</p>
                    <dl
                        v-if="item.libraryItemId || item.quantity !== null"
                        class="panel__bag-item-meta"
                    >
                        <div v-if="item.libraryItemId" class="panel__bag-item-meta-row">
                            <dt>Library ID</dt>
                            <dd>{{ item.libraryItemId }}</dd>
                        </div>
                        <div v-if="item.quantity !== null" class="panel__bag-item-meta-row">
                            <dt>Quantity</dt>
                            <dd>{{ item.quantity }}</dd>
                        </div>
                    </dl>
                </li>
            </ul>
        </section>
    </section>
</template>

<script setup>
import { computed, ref, watchEffect } from 'vue';

import { idsMatch, normalizeId } from '../utils/ids';

const props = defineProps({
    game: { type: Object, required: true },
    me: { type: Object, default: null },
});

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

const isDM = computed(() => idsMatch(props.game?.dmId, props.me?.id));

const players = computed(() => {
    if (!props.game || !Array.isArray(props.game.players)) return [];
    return props.game.players.filter((player) => player && typeof player === 'object');
});

const selectablePlayers = computed(() => {
    const filtered = players.value.filter((player) => {
        const role = typeof player.role === 'string' ? player.role.trim().toLowerCase() : '';
        return role !== 'dm';
    });
    return filtered.length ? filtered : players.value;
});

const playerOptions = computed(() =>
    selectablePlayers.value.map((player, index) => ({
        key: resolvePlayerKey(player, index),
        label: describePlayerName(player),
        player,
    }))
);

const selectedPlayerKey = ref(null);

watchEffect(() => {
    if (!isDM.value) {
        selectedPlayerKey.value = null;
        return;
    }
    const options = playerOptions.value;
    if (!options.length) {
        selectedPlayerKey.value = null;
        return;
    }
    if (options.some((option) => option.key === selectedPlayerKey.value)) {
        return;
    }
    selectedPlayerKey.value = options[0].key;
});

const activePlayer = computed(() => {
    if (isDM.value) {
        const options = playerOptions.value;
        if (!options.length) return null;
        const match = options.find((option) => option.key === selectedPlayerKey.value);
        return (match || options[0]).player;
    }

    const user = props.me;
    if (user) {
        const found = players.value.find((player) => playerMatchesUser(player, user));
        if (found) return found;
    }

    return selectablePlayers.value[0] || null;
});

const bagItems = computed(() => {
    const gear = activePlayer.value?.gear;
    const bag = Array.isArray(gear?.bag) ? gear.bag : [];
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
    const gear = activePlayer.value?.gear;
    const rawSlots = gear && typeof gear.slots === 'object' ? gear.slots : {};
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

function resolvePlayerKey(player, index = 0) {
    const identifiers = collectPlayerIdentifiers(player);
    if (identifiers.length) return identifiers[0];
    return `player:${index + 1}`;
}

function playerMatchesUser(player, user) {
    if (!player || !user) return false;
    const playerIds = collectPlayerIdentifiers(player);
    const userIds = [normalizeId(user.id), normalizeId(user.userId), normalizeId(user.user?.id)].filter(Boolean);
    for (const playerId of playerIds) {
        if (userIds.some((id) => id && idsMatch(id, playerId))) {
            return true;
        }
    }
    return false;
}

function collectPlayerIdentifiers(player) {
    if (!player || typeof player !== 'object') return [];
    const ids = [player.userId, player.id, player.user?.id]
        .map((value) => normalizeId(value))
        .filter((value, index, array) => value && array.indexOf(value) === index);
    return ids;
}

function describePlayerName(player) {
    if (!player || typeof player !== 'object') return 'Unknown player';
    const charName = typeof player.character?.name === 'string' ? player.character.name.trim() : '';
    if (charName) return charName;
    const displayName = typeof player.displayName === 'string' ? player.displayName.trim() : '';
    if (displayName) return displayName;
    const username = typeof player.username === 'string' ? player.username.trim() : '';
    if (username) return username;
    const userId = typeof player.userId === 'string' ? player.userId.trim() : '';
    if (userId) return userId;
    return 'Unknown player';
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

.panel__picker {
    display: inline-flex;
    align-items: center;
}

.panel__picker-select {
    appearance: none;
    background: rgba(12, 15, 30, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 0.6rem;
    color: inherit;
    font: inherit;
    padding: 0.35rem 0.75rem;
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

.panel__gear-slot-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
}

.panel__gear-slot-label {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
}

.panel__gear-type {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.7);
}

.panel__gear-name {
    margin: 0;
    font-weight: 600;
}

.panel__gear-empty {
    margin: 0;
    color: rgba(255, 255, 255, 0.6);
}

.panel__gear-desc {
    margin: 0;
    color: rgba(255, 255, 255, 0.75);
}

.panel__gear-meta {
    margin: 0;
    display: grid;
    gap: 0.25rem;
}

.panel__gear-meta-row {
    display: flex;
    gap: 0.5rem;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.75);
}

.panel__gear-meta-row dt {
    font-weight: 600;
}

.panel__gear-meta-row dd {
    margin: 0;
}

.panel__placeholder {
    color: rgba(255, 255, 255, 0.6);
}

.panel__bag {
    background: rgba(12, 15, 30, 0.45);
    border-radius: 0.9rem;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.panel__bag-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
}

.panel__bag-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
}

.panel__bag-count {
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.7);
}

.panel__bag-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.panel__bag-item {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}

.panel__bag-item-main {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
}

.panel__bag-item-name {
    font-weight: 600;
}

.panel__bag-item-type {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.7);
}

.panel__bag-item-desc {
    margin: 0;
    color: rgba(255, 255, 255, 0.75);
}

.panel__bag-item-meta {
    margin: 0;
    display: grid;
    gap: 0.25rem;
}

.panel__bag-item-meta-row {
    display: flex;
    gap: 0.5rem;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.75);
}

.panel__bag-item-meta-row dt {
    font-weight: 600;
}

.panel__bag-item-meta-row dd {
    margin: 0;
}
</style>
