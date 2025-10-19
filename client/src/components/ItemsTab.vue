<template>
    <section class="panel">
        <header class="panel__header">
            <h3 class="panel__title">Inventory overview</h3>
            <button
                type="button"
                class="button button--small"
                @click="refresh"
                :disabled="refreshing"
            >
                {{ refreshing ? 'Refreshing…' : 'Refresh' }}
            </button>
        </header>

        <nav
            v-if="showVisibilityControls"
            class="panel__filters"
            aria-label="Inventory visibility filter"
        >
            <button
                v-for="option in filterOptions"
                :key="option.value"
                type="button"
                class="panel__filters-button"
                :class="{ 'is-active': option.value === activeViewMode }"
                :aria-pressed="option.value === activeViewMode ? 'true' : 'false'"
                @click="() => setViewMode(option.value)"
            >
                {{ option.label }}
            </button>
        </nav>

        <p v-if="!visibleItems.length" class="panel__placeholder">{{ emptyMessage }}</p>
        <ul v-else class="panel__list">
            <li v-for="item in visibleItems" :key="item.key" class="panel__list-item">
                <header class="item-row__header">
                    <div class="item-row__title">
                        <strong>{{ item.name || 'Unnamed item' }}</strong>
                        <div class="item-row__meta">
                            <span v-if="item.type" class="item-row__type">{{ item.type }}</span>
                            <span v-if="item.libraryItemId" class="item-row__library">
                                Library: {{ item.libraryItemId }}
                            </span>
                            <span
                                v-if="item.visibility === 'dm'"
                                class="item-row__badge item-row__badge--dm"
                            >
                                DM only
                            </span>
                            <span v-else-if="item.visibility === 'mixed'" class="item-row__badge">
                                DM + party
                            </span>
                        </div>
                    </div>
                    <span class="item-row__quantity" :aria-label="`Total quantity: ${item.totalQuantity}`">
                        ×{{ item.totalQuantity }}
                    </span>
                </header>
                <p v-if="item.description" class="panel__desc">{{ item.description }}</p>
                <ul class="item-holders">
                    <li
                        v-for="(holder, index) in item.holders"
                        :key="holder.id || holder.name || index"
                        class="item-holders__item"
                    >
                        <span class="item-holders__name">
                            {{ holder.name }}
                            <span v-if="holder.kind === 'dm'" class="item-holders__role">DM</span>
                            <span v-else-if="holder.kind === 'shared'" class="item-holders__role">Shared</span>
                        </span>
                        <span class="item-holders__quantity">×{{ holder.quantity }}</span>
                    </li>
                </ul>
            </li>
        </ul>
    </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

import { idsMatch } from '../utils/ids';

const props = defineProps({
    game: { type: Object, required: true },
    me: { type: Object, default: null },
    realtime: { type: Object, default: null },
    onUpdate: { type: Function, default: null },
});

const emit = defineEmits(['update']);

const refreshing = ref(false);
const viewMode = ref('party');

const isDM = computed(() => idsMatch(props.game?.dmId, props.me?.id));

watch(
    () => isDM.value,
    (value) => {
        if (!value) {
            viewMode.value = 'party';
        }
    }
);

const groupedItems = computed(() => buildItemStash(props.game));

const activeViewMode = computed(() => (isDM.value ? viewMode.value : 'party'));

const visibleItems = computed(() => {
    const mode = activeViewMode.value;
    const items = groupedItems.value;
    switch (mode) {
        case 'dm':
            return items.filter((item) => item.visibility === 'dm');
        case 'all':
            return items;
        case 'party':
        default:
            return items.filter((item) => item.visibility !== 'dm');
    }
});

const showVisibilityControls = computed(() => isDM.value && groupedItems.value.length > 0);

const filterOptions = computed(() => {
    if (!isDM.value) return [];
    return [
        { value: 'party', label: 'Party view' },
        { value: 'dm', label: 'DM stash' },
        { value: 'all', label: 'All items' },
    ];
});

const emptyMessage = computed(() => {
    if (!groupedItems.value.length) {
        return 'No items found for this campaign.';
    }
    if (visibleItems.value.length) {
        return '';
    }
    const mode = activeViewMode.value;
    if (mode === 'dm') return 'No DM-only items found.';
    if (mode === 'party') return 'No items are visible to the party yet.';
    return 'No items match this filter.';
});

function setViewMode(mode) {
    if (!isDM.value) return;
    viewMode.value = mode;
}

async function refresh() {
    if (refreshing.value) return;
    refreshing.value = true;
    try {
        if (typeof props.onUpdate === 'function') {
            await props.onUpdate();
        }
    } catch (err) {
        console.error(err);
    } finally {
        emit('update');
        refreshing.value = false;
    }
}

const HOLDER_SORT_ORDER = { player: 0, shared: 1, dm: 2, unknown: 3 };

function buildItemStash(game) {
    if (!game || typeof game !== 'object') return [];
    const groups = new Map();
    let fallbackCounter = 0;

    const addItem = (item, holder) => {
        if (!item || typeof item !== 'object') return;
        const quantity = readItemQuantity(item);
        if (quantity <= 0) return;

        const libraryId = readLibraryId(item);
        const rawName = readItemName(item);
        const normalizedName = rawName ? rawName.toLowerCase() : '';
        const itemId = typeof item.id === 'string' && item.id ? item.id : null;
        const key = libraryId
            ? `library:${libraryId.toLowerCase()}`
            : normalizedName
              ? `name:${normalizedName}`
              : itemId
                ? `id:${itemId}`
                : `fallback:${++fallbackCounter}`;

        let group = groups.get(key);
        const description = readItemDescription(item);
        const type = readItemType(item);

        if (!group) {
            group = {
                key,
                libraryItemId: libraryId,
                name: rawName || 'Unnamed item',
                type,
                description,
                totalQuantity: 0,
                holders: new Map(),
            };
            groups.set(key, group);
        } else {
            if (!group.libraryItemId && libraryId) group.libraryItemId = libraryId;
            if ((!group.name || group.name === 'Unnamed item') && rawName) group.name = rawName;
            if (!group.type && type) group.type = type;
            if (description && (!group.description || group.description.length < description.length)) {
                group.description = description;
            }
        }

        group.totalQuantity += quantity;

        const holderKey = holder?.id || holder?.name || `holder:${group.holders.size + 1}`;
        const existing = group.holders.get(holderKey);
        if (existing) {
            existing.quantity += quantity;
            if (existing.kind === 'unknown' && holder?.kind) {
                existing.kind = holder.kind;
            }
        } else {
            group.holders.set(holderKey, {
                id: holder?.id || null,
                name: holder?.name || 'Unknown',
                kind: holder?.kind || 'unknown',
                quantity,
            });
        }
    };

    const players = Array.isArray(game.players) ? game.players : [];
    for (const player of players) {
        if (!player || typeof player !== 'object') continue;
        const inventory = Array.isArray(player.inventory) ? player.inventory : [];
        if (!inventory.length) continue;
        const role = (player.role || '').toLowerCase();
        const kind = role === 'dm' ? 'dm' : 'player';
        const holderId = typeof player.userId === 'string' && player.userId ? `player:${player.userId}` : null;
        const holderName = describePlayerName(player, kind === 'dm');
        for (const item of inventory) {
            addItem(item, { id: holderId, name: holderName, kind });
        }
    }

    const pools = extractSharedPools(game);
    for (const pool of pools) {
        const items = Array.isArray(pool.items) ? pool.items : [];
        if (!items.length) continue;
        const holderId = pool.id ? `pool:${pool.id}` : null;
        const holderName = pool.name || 'Shared pool';
        const kind = pool.kind || 'shared';
        for (const item of items) {
            addItem(item, { id: holderId, name: holderName, kind });
        }
    }

    const result = [];
    for (const group of groups.values()) {
        const holders = Array.from(group.holders.values()).sort(sortHolders);
        const hasPlayerVisible = holders.some((holder) => holder.kind === 'player' || holder.kind === 'shared');
        const hasDMHolder = holders.some((holder) => holder.kind === 'dm');
        const visibility = hasPlayerVisible ? (hasDMHolder ? 'mixed' : 'party') : 'dm';
        result.push({
            key: group.key,
            libraryItemId: group.libraryItemId || null,
            name: group.name || 'Unnamed item',
            type: group.type || '',
            description: group.description || '',
            totalQuantity: group.totalQuantity,
            holders,
            visibility,
        });
    }

    return result.sort(sortItems);
}

function sortItems(a, b) {
    const nameCompare = (a.name || '').localeCompare(b.name || '', undefined, {
        numeric: true,
        sensitivity: 'base',
    });
    if (nameCompare !== 0) return nameCompare;
    const idCompare = (a.libraryItemId || '').localeCompare(b.libraryItemId || '', undefined, {
        numeric: true,
        sensitivity: 'base',
    });
    if (idCompare !== 0) return idCompare;
    return (b.totalQuantity || 0) - (a.totalQuantity || 0);
}

function sortHolders(a, b) {
    const left = HOLDER_SORT_ORDER[a.kind] ?? HOLDER_SORT_ORDER.unknown;
    const right = HOLDER_SORT_ORDER[b.kind] ?? HOLDER_SORT_ORDER.unknown;
    if (left !== right) return left - right;
    return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
}

function extractSharedPools(game) {
    const pools = [];
    if (!game || typeof game !== 'object') return pools;
    const seen = new Set();

    const append = (value, fallbackName) => {
        const normalized = normalizePools(value, fallbackName);
        for (const pool of normalized) {
            const key = `${pool.id || ''}::${pool.name || ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            pools.push(pool);
        }
    };

    append(game.sharedInventory, 'Shared inventory');
    append(game.sharedInventories, 'Shared inventory');
    append(game.inventoryPools, 'Shared pool');
    append(game.itemPools, 'Shared pool');

    const itemsNode = game.items;
    if (itemsNode && typeof itemsNode === 'object') {
        append(itemsNode.shared, 'Shared pool');
        append(itemsNode.pools, 'Shared pool');
        append(itemsNode.stash, 'Shared pool');
    }

    return pools;
}

function normalizePools(value, fallbackName = 'Shared pool') {
    const results = [];
    if (!value) return results;

    const baseId = toSlug(fallbackName) || 'shared-pool';
    let counter = 0;

    const pushPool = (id, name, kind, items) => {
        const filtered = Array.isArray(items) ? items.filter(isInventoryItem) : [];
        if (!filtered.length) return;
        counter += 1;
        results.push({
            id: id || `${baseId}-${counter}`,
            name: name || fallbackName,
            kind: kind || 'shared',
            items: filtered,
        });
    };

    if (Array.isArray(value)) {
        const directItems = value.every((entry) => isInventoryItem(entry));
        if (directItems) {
            pushPool(null, fallbackName, 'shared', value);
            return results;
        }

        value.forEach((entry, index) => {
            if (!entry) return;
            if (Array.isArray(entry)) {
                pushPool(null, fallbackName, 'shared', entry);
                return;
            }
            const items = selectItemList(entry);
            pushPool(
                entry.id || entry.key || entry.slug || `${baseId}-${index + 1}`,
                entry.name || entry.title || entry.label || fallbackName,
                entry.kind,
                items
            );
        });
        return results;
    }

    if (typeof value === 'object') {
        Object.entries(value).forEach(([key, entry], index) => {
            if (!entry) return;
            if (Array.isArray(entry)) {
                pushPool(key || `${baseId}-${index + 1}`, fallbackName, 'shared', entry);
                return;
            }
            const items = selectItemList(entry);
            pushPool(
                entry.id || key || `${baseId}-${index + 1}`,
                entry.name || entry.title || entry.label || fallbackName,
                entry.kind,
                items
            );
        });
    }

    return results;
}

function selectItemList(entry) {
    if (!entry || typeof entry !== 'object') return [];
    if (Array.isArray(entry.items)) return entry.items;
    if (Array.isArray(entry.inventory)) return entry.inventory;
    if (Array.isArray(entry.list)) return entry.list;
    if (Array.isArray(entry.contents)) return entry.contents;
    return [];
}

function isInventoryItem(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    if (
        Array.isArray(entry.items) ||
        Array.isArray(entry.inventory) ||
        Array.isArray(entry.list) ||
        Array.isArray(entry.contents)
    ) {
        return false;
    }
    const hasAmount = Object.prototype.hasOwnProperty.call(entry, 'amount');
    if (hasAmount && readItemQuantity(entry) <= 0) return false;
    const name = readItemName(entry);
    const libraryId = readLibraryId(entry);
    const desc = readItemDescription(entry);
    if (!hasAmount && !libraryId && !name && !desc) return false;
    return Boolean(name || libraryId || desc || hasAmount);
}

function describePlayerName(player, isDm = false) {
    if (!player || typeof player !== 'object') return isDm ? 'Game Master' : 'Unknown player';
    const charName = typeof player.character?.name === 'string' ? player.character.name.trim() : '';
    if (charName) return charName;
    const displayName = typeof player.displayName === 'string' ? player.displayName.trim() : '';
    if (displayName) return displayName;
    const username = typeof player.username === 'string' ? player.username.trim() : '';
    if (username) return username;
    const fallback = typeof player.userId === 'string' ? player.userId.trim() : '';
    if (fallback) return isDm ? `DM ${fallback}` : `Player ${fallback}`;
    return isDm ? 'Game Master' : 'Player';
}

function readItemQuantity(item) {
    if (!item || typeof item !== 'object') return 0;
    const raw = Number(item.amount);
    if (Number.isFinite(raw)) {
        const rounded = Math.round(raw);
        return rounded > 0 ? rounded : 0;
    }
    return 1;
}

function readLibraryId(item) {
    if (!item || typeof item !== 'object') return null;
    const primary = typeof item.libraryItemId === 'string' ? item.libraryItemId.trim() : '';
    if (primary) return primary;
    const secondary = typeof item.libraryId === 'string' ? item.libraryId.trim() : '';
    return secondary || null;
}

function readItemName(item) {
    if (!item || typeof item !== 'object') return '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    return name;
}

function readItemDescription(item) {
    if (!item || typeof item !== 'object') return '';
    const desc = typeof item.desc === 'string' ? item.desc.trim() : '';
    if (desc) return desc;
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    return description;
}

function readItemType(item) {
    if (!item || typeof item !== 'object') return '';
    const type = typeof item.type === 'string' ? item.type.trim() : '';
    return type;
}

function toSlug(value) {
    if (typeof value !== 'string') return '';
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
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

.panel__filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
}

.panel__filters-button {
    border: none;
    border-radius: 999px;
    padding: 0.3rem 0.85rem;
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.75);
    cursor: pointer;
    font-size: 0.8rem;
    transition: background var(--trans-fast, 120ms ease), color var(--trans-fast, 120ms ease);
}

.panel__filters-button.is-active {
    background: rgba(255, 255, 255, 0.24);
    color: rgba(255, 255, 255, 0.95);
}

.item-row__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
}

.item-row__title {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}

.item-row__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.6);
}

.item-row__quantity {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    padding: 0.2rem 0.6rem;
    font-size: 0.85rem;
    font-weight: 600;
    background: rgba(255, 255, 255, 0.16);
    color: rgba(255, 255, 255, 0.85);
}

.item-row__badge {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 0.15rem 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.68rem;
    background: rgba(255, 255, 255, 0.18);
    color: rgba(255, 255, 255, 0.85);
}

.item-row__badge--dm {
    background: rgba(255, 98, 98, 0.25);
    color: rgba(255, 205, 205, 0.95);
}

.panel__desc {
    margin: 0;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.7);
}

.panel__placeholder {
    color: rgba(255, 255, 255, 0.6);
}

.item-holders {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
}

.item-holders__item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
}

.item-holders__name {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
}

.item-holders__role {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 0.1rem 0.4rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.68rem;
    background: rgba(255, 255, 255, 0.18);
    color: rgba(255, 255, 255, 0.75);
}

.item-holders__quantity {
    font-weight: 600;
    color: rgba(255, 255, 255, 0.85);
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
