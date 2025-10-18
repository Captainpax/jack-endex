<template>
    <div class="app-root">
        <LoadingBar />
        <div ref="reactMount" class="react-root"></div>
    </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

const reactMount = ref(null);
let reactRoot = null;

onMounted(() => {
    if (!reactMount.value) {
        return;
    }

    reactRoot = ReactDOM.createRoot(reactMount.value);
    reactRoot.render(
        React.createElement(
            React.StrictMode,
            null,
            React.createElement(App)
        )
    );
});

onBeforeUnmount(() => {
    if (reactRoot) {
        reactRoot.unmount();
        reactRoot = null;
    }
});
</script>
