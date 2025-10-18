<template>
    <div :class="containerClass">
        <label>{{ label }}</label>
        <input
            type="text"
            v-model="draft"
            :class="{ 'input-error': !!error }"
            @blur="commit"
            @keydown.enter.prevent="commit"
            @keydown.esc.prevent="reset"
            spellcheck="false"
            autocomplete="off"
            autocapitalize="off"
            title="Supports +, -, ×, ÷, and parentheses"
            :aria-invalid="error ? 'true' : undefined"
            :disabled="disabled"
        />
        <span v-if="error" class="text-error text-small">{{ error }}</span>
    </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({
    label: { type: String, default: '' },
    value: { type: [Number, String], default: '' },
    onCommit: { type: Function, default: null },
    className: { type: String, default: '' },
    disabled: { type: Boolean, default: false },
});

const draft = ref(formatNumber(props.value));
const dirty = ref(false);
const error = ref('');

watch(
    () => props.value,
    (next) => {
        if (!dirty.value) {
            draft.value = formatNumber(next);
        }
    }
);

watch(draft, () => {
    dirty.value = true;
    if (error.value) error.value = '';
});

const containerClass = computed(() => (props.className ? `col ${props.className}` : 'col'));

function reset() {
    draft.value = formatNumber(props.value);
    dirty.value = false;
    error.value = '';
}

function commit() {
    if (!dirty.value) return;
    const raw = draft.value.trim();
    if (!raw) {
        props.onCommit?.(0);
        draft.value = '0';
        dirty.value = false;
        error.value = '';
        return;
    }
    const result = evaluateMathExpression(raw);
    if (!result.ok) {
        error.value = result.reason || 'Invalid expression';
        return;
    }
    props.onCommit?.(result.value);
    draft.value = formatNumber(result.value);
    dirty.value = false;
    error.value = '';
}

function evaluateMathExpression(input) {
    const sanitized = input.replace(/×/g, '*').replace(/÷/g, '/');
    const stripped = sanitized.replace(/\s+/g, '');
    if (!stripped) {
        return { ok: false, reason: 'Enter a value' };
    }
    if (!/^[0-9+\-*/().]+$/.test(stripped)) {
        return { ok: false, reason: 'Use numbers and + - × ÷ ()' };
    }
    try {
        const value = Function(`"use strict";return (${stripped});`)();
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return { ok: false, reason: 'Calculation failed' };
        }
        return { ok: true, value };
    } catch {
        return { ok: false, reason: 'Calculation failed' };
    }
}

function formatNumber(value) {
    if (value === null || value === undefined) return '';
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return '';
    return String(num);
}
</script>

<script>
export default {
    name: 'MathField',
};
</script>

<style scoped>
.col {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}

label {
    font-weight: 600;
    font-size: 0.85rem;
}

input {
    border-radius: 0.6rem;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(12, 15, 30, 0.75);
    padding: 0.55rem 0.75rem;
    color: inherit;
}

input:focus {
    outline: none;
    border-color: rgba(90, 173, 255, 0.65);
    box-shadow: 0 0 0 2px rgba(90, 173, 255, 0.25);
}

.input-error {
    border-color: #ff8a8a;
}

.text-error {
    color: #ff8a8a;
}

.text-small {
    font-size: 0.75rem;
}
</style>
