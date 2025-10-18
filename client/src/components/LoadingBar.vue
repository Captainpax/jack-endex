<template>
    <div :class="className" role="presentation" aria-hidden="true">
        <div class="loading-bar__track">
            <div class="loading-bar__indicator"></div>
        </div>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onApiActivity } from '../api';

const HIDE_DELAY = 240;

const active = ref(false);
const visible = ref(false);
const hideTimeoutRef = ref(null);
const hasInteractedRef = ref(false);
let unsubscribe = null;

function clearHideTimeout() {
    if (hideTimeoutRef.value !== null) {
        clearTimeout(hideTimeoutRef.value);
        hideTimeoutRef.value = null;
    }
}

onMounted(() => {
    unsubscribe = onApiActivity((value) => {
        active.value = Boolean(value);
    });
});

watch(
    active,
    (isActive) => {
        if (isActive) {
            hasInteractedRef.value = true;
            clearHideTimeout();
            visible.value = true;
            return;
        }

        if (!hasInteractedRef.value) {
            return;
        }

        clearHideTimeout();
        hideTimeoutRef.value = window.setTimeout(() => {
            visible.value = false;
            hideTimeoutRef.value = null;
        }, HIDE_DELAY);
    },
    { flush: 'post' }
);

onBeforeUnmount(() => {
    clearHideTimeout();
    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }
});

const finishing = computed(() => visible.value && !active.value);

const className = computed(() =>
    [
        'loading-bar',
        visible.value ? 'loading-bar--visible' : '',
        active.value ? 'loading-bar--active' : '',
        finishing.value ? 'loading-bar--finishing' : '',
    ]
        .filter(Boolean)
        .join(' ')
);
</script>
