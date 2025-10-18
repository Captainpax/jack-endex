<template>
    <figure class="demon-image">
        <img :src="resolvedSrc" :alt="altText" loading="lazy" />
        <figcaption v-if="caption" class="demon-image__caption">{{ caption }}</figcaption>
    </figure>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
    src: { type: String, default: '' },
    name: { type: String, default: '' },
    caption: { type: String, default: '' },
});

const resolvedSrc = computed(() => props.src || '/placeholder-demon.png');
const altText = computed(() => props.name || 'Demon');
const caption = computed(() => props.caption || props.name || '');
</script>

<style scoped>
.demon-image {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: center;
}

.demon-image img {
    width: 100%;
    max-width: 320px;
    border-radius: 1rem;
    object-fit: cover;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
}

.demon-image__caption {
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.7);
    text-align: center;
}
</style>
