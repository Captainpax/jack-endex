<template>
    <nav class="nav-drawer__nav" aria-label="Game navigation">
        <template v-if="filteredItems.length">
            <ul class="nav-drawer__list">
                <li v-for="item in filteredItems" :key="item.key" class="nav-drawer__item">
                    <button
                        type="button"
                        :class="['nav-drawer__button', { 'is-active': item.key === activeKey }]"
                        @click="() => emitSelect(item.key)"
                        :aria-pressed="item.key === activeKey"
                        :aria-current="item.key === activeKey ? 'page' : undefined"
                    >
                        <span class="nav-drawer__badge" aria-hidden>{{ badgeLabel(item.label) }}</span>
                        <span class="nav-drawer__text">
                            <span class="nav-drawer__label">{{ item.label }}</span>
                            <span v-if="item.description" class="nav-drawer__desc">{{ item.description }}</span>
                        </span>
                        <span class="nav-drawer__chevron" aria-hidden>
                            <svg viewBox="0 0 20 20" focusable="false" aria-hidden>
                                <path
                                    d="M7 5l5 5-5 5"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                />
                            </svg>
                        </span>
                    </button>
                </li>
            </ul>
        </template>
        <p v-else class="nav-drawer__empty">No navigation options available.</p>
    </nav>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
    items: {
        type: Array,
        default: () => [],
    },
    activeKey: {
        type: String,
        default: '',
    },
});

const emit = defineEmits(['select']);

const filteredItems = computed(() =>
    (Array.isArray(props.items) ? props.items : []).filter((item) => item && item.key)
);

function badgeLabel(label) {
    if (typeof label !== 'string' || !label.trim()) return '';
    const words = label.trim().split(/\s+/);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
}

function emitSelect(key) {
    if (!key) return;
    emit('select', key);
}
</script>

<style scoped>
.nav-drawer__nav {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    background: rgba(12, 15, 30, 0.7);
    border-radius: 1rem;
    padding: 1rem;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
}

.nav-drawer__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.nav-drawer__item {
    border-radius: 0.75rem;
    overflow: hidden;
}

.nav-drawer__button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    border: none;
    padding: 0.65rem 0.75rem;
    border-radius: 0.75rem;
    background: rgba(30, 36, 58, 0.9);
    color: inherit;
    cursor: pointer;
    transition: transform 0.15s ease, background 0.2s ease;
}

.nav-drawer__button:hover {
    transform: translateY(-1px);
    background: rgba(45, 60, 90, 0.95);
}

.nav-drawer__button.is-active {
    background: linear-gradient(135deg, rgba(90, 173, 255, 0.95), rgba(130, 248, 255, 0.95));
    color: #0b1628;
    box-shadow: 0 10px 25px rgba(80, 180, 255, 0.3);
}

.nav-drawer__badge {
    width: 2rem;
    height: 2rem;
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.15);
    font-weight: 600;
}

.nav-drawer__button.is-active .nav-drawer__badge {
    background: rgba(11, 22, 40, 0.15);
}

.nav-drawer__text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    flex: 1;
    text-align: left;
}

.nav-drawer__label {
    font-weight: 600;
}

.nav-drawer__desc {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.65);
}

.nav-drawer__chevron {
    display: flex;
    align-items: center;
}

.nav-drawer__chevron svg {
    width: 1rem;
    height: 1rem;
}

.nav-drawer__empty {
    margin: 0;
    color: rgba(255, 255, 255, 0.6);
    text-align: center;
}
</style>
