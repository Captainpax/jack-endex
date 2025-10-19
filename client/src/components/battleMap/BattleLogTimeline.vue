<template>
    <section class="battle-log-timeline">
        <header class="battle-log-timeline__header">
            <div>
                <h3>Battle log</h3>
                <p class="battle-log-timeline__description">
                    Entries appear in real time as encounters unfold.
                </p>
            </div>
            <div class="battle-log-timeline__filters">
                <label class="battle-log-timeline__filter">
                    <span class="battle-log-timeline__filter-label">Actor</span>
                    <select v-model="selectedActor" class="battle-log-timeline__select">
                        <option value="">All actors</option>
                        <option v-for="actor in actorOptions" :key="actor.value" :value="actor.value">
                            {{ actor.label }}
                        </option>
                    </select>
                </label>
                <label class="battle-log-timeline__filter">
                    <span class="battle-log-timeline__filter-label">Action</span>
                    <select v-model="selectedAction" class="battle-log-timeline__select">
                        <option value="">All actions</option>
                        <option v-for="action in actionOptions" :key="action" :value="action">
                            {{ action }}
                        </option>
                    </select>
                </label>
            </div>
        </header>

        <div class="battle-log-timeline__summary">
            <p>
                Showing {{ filteredEntries.length }} of {{ entries.length }} entries •
                Actors: {{ filteredActorCount }} • Actions: {{ filteredActionCount }}
            </p>
            <button type="button" class="battle-log-timeline__toggle" @click="toggleCollapsed">
                {{ collapsed ? 'Expand log' : 'Collapse log' }}
            </button>
        </div>

        <div v-if="collapsed" class="battle-log-timeline__collapsed-note">
            Timeline collapsed. Expand to view individual entries.
        </div>

        <div v-else class="battle-log-timeline__scroller">
            <p v-if="!filteredEntries.length" class="battle-log-timeline__empty">
                No battle log entries match the current filters.
            </p>
            <article
                v-for="entry in filteredEntries"
                :key="entry.id"
                class="battle-log-timeline__entry"
            >
                <div class="battle-log-timeline__timeline-marker"></div>
                <div class="battle-log-timeline__card">
                    <header class="battle-log-timeline__card-header">
                        <div class="battle-log-timeline__avatar" :style="avatarStyle(entry)">
                            <span>{{ actorInitial(entry) }}</span>
                        </div>
                        <div class="battle-log-timeline__meta">
                            <span class="battle-log-timeline__time">{{ formatLogTime(entry.createdAt) }}</span>
                            <span class="battle-log-timeline__actor">{{ resolveActorName(entry.actorId) }}</span>
                        </div>
                        <span class="battle-log-timeline__action" :style="actionStyle(entry.action)">
                            {{ entry.action }}
                        </span>
                    </header>
                    <div class="battle-log-timeline__body">
                        <p v-if="entry.message" class="battle-log-timeline__message">{{ entry.message }}</p>
                        <button
                            v-if="showDetailsButton(entry)"
                            type="button"
                            class="battle-log-timeline__details-toggle"
                            @click="toggleEntry(entry.id)"
                        >
                            {{ isEntryExpanded(entry.id) ? 'Hide details' : 'Show details' }}
                        </button>
                        <pre
                            v-if="isEntryExpanded(entry.id) && hasLogDetails(entry)"
                            class="battle-log-timeline__details"
                        >{{ formatLogDetails(entry.details) }}</pre>
                    </div>
                </div>
            </article>
        </div>
    </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({
    entries: { type: Array, default: () => [] },
    formatLogTime: { type: Function, required: true },
    formatLogDetails: { type: Function, required: true },
    hasLogDetails: { type: Function, required: true },
    resolveActorName: { type: Function, required: true },
});

const formatLogTime = (...args) => props.formatLogTime(...args);
const formatLogDetails = (...args) => props.formatLogDetails(...args);
const hasLogDetails = (entry) => props.hasLogDetails(entry);
const resolveActorName = (...args) => props.resolveActorName(...args);

const collapsed = ref(false);
const selectedActor = ref('');
const selectedAction = ref('');
const expandedEntries = ref(new Set());

const actorOptions = computed(() => {
    const seen = new Map();
    for (const entry of props.entries) {
        const key = actorKey(entry);
        if (!seen.has(key)) {
            const label = resolveActorName(entry.actorId) || 'System';
            seen.set(key, {
                value: key,
                label,
            });
        }
    }
    return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
});

const actionOptions = computed(() => {
    const actions = new Set();
    for (const entry of props.entries) {
        if (entry && typeof entry.action === 'string' && entry.action.trim()) {
            actions.add(entry.action.trim());
        }
    }
    return Array.from(actions).sort((a, b) => a.localeCompare(b));
});

watch(actorOptions, (options) => {
    if (!selectedActor.value) return;
    if (!options.some((option) => option.value === selectedActor.value)) {
        selectedActor.value = '';
    }
});

watch(actionOptions, (options) => {
    if (!selectedAction.value) return;
    if (!options.includes(selectedAction.value)) {
        selectedAction.value = '';
    }
});

const filteredEntries = computed(() => {
    const actorFilter = selectedActor.value;
    const actionFilter = selectedAction.value;
    return props.entries.filter((entry) => {
        if (!entry) return false;
        if (actorFilter && actorKey(entry) !== actorFilter) return false;
        const entryAction = typeof entry.action === 'string' ? entry.action.trim() : entry.action;
        if (actionFilter && entryAction !== actionFilter) return false;
        return true;
    });
});

const filteredActorCount = computed(() => {
    const actors = new Set();
    for (const entry of filteredEntries.value) {
        actors.add(actorKey(entry));
    }
    return actors.size;
});

const filteredActionCount = computed(() => {
    const actions = new Set();
    for (const entry of filteredEntries.value) {
        if (entry && typeof entry.action === 'string' && entry.action.trim()) {
            actions.add(entry.action.trim());
        }
    }
    return actions.size;
});

watch(
    () => props.entries,
    () => {
        expandedEntries.value = new Set();
    },
    { deep: false }
);

const avatarColorCache = new Map();

function actorKey(entry) {
    if (!entry || entry.actorId === null || entry.actorId === undefined) {
        return '__system__';
    }
    return String(entry.actorId);
}

function actorInitial(entry) {
    const name = resolveActorName(entry.actorId) || '';
    const trimmed = name.trim();
    if (!trimmed) return '?';
    return trimmed.charAt(0).toUpperCase();
}

function actionStyle(action) {
    const color = colorForSeed(action || 'action');
    return {
        backgroundColor: color,
    };
}

function avatarStyle(entry) {
    const key = actorKey(entry);
    const color = colorForSeed(`avatar:${key}`);
    return {
        backgroundColor: color,
    };
}

function colorForSeed(seed) {
    if (!seed) return 'var(--battle-log-chip, #334155)';
    if (!avatarColorCache.has(seed)) {
        let hash = 0;
        for (let i = 0; i < seed.length; i += 1) {
            hash = (hash << 5) - hash + seed.charCodeAt(i);
            hash |= 0;
        }
        const hue = Math.abs(hash) % 360;
        avatarColorCache.set(seed, `hsl(${hue}, 70%, 45%)`);
    }
    return avatarColorCache.get(seed);
}

function toggleEntry(id) {
    const next = new Set(expandedEntries.value);
    if (next.has(id)) {
        next.delete(id);
    } else {
        next.add(id);
    }
    expandedEntries.value = next;
}

function isEntryExpanded(id) {
    return expandedEntries.value.has(id);
}

function showDetailsButton(entry) {
    return Boolean(entry?.message) || hasLogDetails(entry);
}

function toggleCollapsed() {
    collapsed.value = !collapsed.value;
}

</script>

<style scoped>
.battle-log-timeline {
    display: grid;
    gap: 16px;
    color: #e2e8f0;
}

.battle-log-timeline__header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-end;
}

.battle-log-timeline__description {
    margin: 6px 0 0;
    color: rgba(148, 163, 184, 0.85);
    font-size: 0.85rem;
}

.battle-log-timeline__filters {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
}

.battle-log-timeline__filter {
    display: grid;
    gap: 4px;
    min-width: 140px;
}

.battle-log-timeline__filter-label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(148, 163, 184, 0.85);
}

.battle-log-timeline__select {
    appearance: none;
    border-radius: var(--radius);
    border: 1px solid rgba(71, 85, 105, 0.6);
    padding: 6px 10px;
    background: rgba(15, 23, 42, 0.7);
    color: inherit;
    font-size: 0.85rem;
    outline: none;
}

.battle-log-timeline__select:focus {
    border-color: rgba(96, 165, 250, 0.85);
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.35);
}

.battle-log-timeline__summary {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(71, 85, 105, 0.4);
    border-radius: var(--radius);
    padding: 10px 12px;
    font-size: 0.85rem;
    color: rgba(226, 232, 240, 0.95);
}

.battle-log-timeline__toggle {
    border: none;
    border-radius: 999px;
    background: rgba(51, 65, 85, 0.6);
    color: inherit;
    font-weight: 600;
    font-size: 0.8rem;
    padding: 6px 14px;
    cursor: pointer;
}

.battle-log-timeline__toggle:hover,
.battle-log-timeline__toggle:focus {
    background: rgba(59, 130, 246, 0.25);
    color: #bfdbfe;
    outline: none;
}

.battle-log-timeline__collapsed-note {
    font-size: 0.85rem;
    color: rgba(148, 163, 184, 0.85);
}

.battle-log-timeline__scroller {
    max-height: 420px;
    overflow-y: auto;
    padding-right: 6px;
    display: grid;
    gap: 16px;
}

.battle-log-timeline__empty {
    margin: 0;
    padding: 12px;
    font-size: 0.85rem;
    color: rgba(148, 163, 184, 0.9);
    text-align: center;
}

.battle-log-timeline__entry {
    display: grid;
    grid-template-columns: 20px 1fr;
    gap: 12px;
}

.battle-log-timeline__timeline-marker {
    position: relative;
}

.battle-log-timeline__timeline-marker::before {
    content: '';
    position: absolute;
    inset: 0;
    margin: 2px auto;
    width: 3px;
    background: linear-gradient(180deg, rgba(59, 130, 246, 0.5), rgba(125, 211, 252, 0.25));
    border-radius: 999px;
}

.battle-log-timeline__card {
    background: rgba(15, 23, 42, 0.65);
    border: 1px solid rgba(71, 85, 105, 0.55);
    border-radius: calc(var(--radius) * 1.1);
    padding: 12px;
    display: grid;
    gap: 10px;
}

.battle-log-timeline__card-header {
    display: flex;
    gap: 12px;
    align-items: center;
}

.battle-log-timeline__avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: rgba(15, 23, 42, 0.95);
    font-weight: 700;
    text-transform: uppercase;
}

.battle-log-timeline__meta {
    display: grid;
    gap: 4px;
    flex: 1 1 auto;
}

.battle-log-timeline__time {
    font-size: 0.75rem;
    color: rgba(148, 163, 184, 0.85);
}

.battle-log-timeline__actor {
    font-weight: 600;
    font-size: 0.95rem;
    color: rgba(226, 232, 240, 0.95);
}

.battle-log-timeline__action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(15, 23, 42, 0.9);
}

.battle-log-timeline__body {
    display: grid;
    gap: 10px;
}

.battle-log-timeline__message {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.4;
}

.battle-log-timeline__details-toggle {
    justify-self: flex-start;
    border: none;
    background: rgba(59, 130, 246, 0.15);
    color: #bfdbfe;
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
}

.battle-log-timeline__details-toggle:hover,
.battle-log-timeline__details-toggle:focus {
    background: rgba(59, 130, 246, 0.3);
    outline: none;
}

.battle-log-timeline__details {
    margin: 0;
    padding: 10px;
    border-radius: var(--radius);
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(71, 85, 105, 0.5);
    max-height: 240px;
    overflow: auto;
    font-family: var(--font-mono, 'SFMono-Regular', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace);
    font-size: 0.75rem;
    color: rgba(226, 232, 240, 0.9);
    white-space: pre-wrap;
}

@media (max-width: 640px) {
    .battle-log-timeline__header {
        align-items: stretch;
    }

    .battle-log-timeline__filters {
        width: 100%;
        justify-content: space-between;
    }

    .battle-log-timeline__filter {
        flex: 1 1 45%;
    }
}
</style>

