<template>
  <section
    class="collapsible-section"
    :class="{ 'collapsible-section--expanded': isExpanded }"
  >
    <header class="collapsible-section__header">
      <button
        :id="`${panelId}-trigger`"
        class="collapsible-section__toggle"
        type="button"
        :aria-expanded="isExpanded"
        :aria-controls="panelId"
        @click="toggle"
        @keydown.space.prevent="toggle"
        @keydown.enter.prevent="toggle"
      >
        <span class="collapsible-section__icon" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M6 8l4 4 4-4"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <span class="collapsible-section__header-content">
          <slot name="header" />
        </span>
      </button>
    </header>
    <div
      :id="panelId"
      class="collapsible-section__body"
      role="region"
      :aria-labelledby="`${panelId}-trigger`"
      :aria-hidden="!isExpanded"
    >
      <div class="collapsible-section__body-inner">
        <slot name="body">
          <slot />
        </slot>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps({
  defaultExpanded: {
    type: Boolean,
    default: true,
  },
});

const isExpanded = ref(props.defaultExpanded);
const panelId = `collapsible-${Math.random().toString(36).slice(2, 9)}`;

const toggle = () => {
  isExpanded.value = !isExpanded.value;
};

</script>
