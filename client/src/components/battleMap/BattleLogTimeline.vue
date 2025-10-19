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
            seen.set(key, {
                value: key,
                label: resolveActorName(entry.actorId),
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
        if (actionFilter && entry.action !== actionFilter) return false;
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
        if (entry && typeof entry.action === 'string') {
            actions.add(entry.action);
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

