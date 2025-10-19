<template>
    <div class="auth-view">
        <LoadingBar />
        <section class="auth-card">
            <header class="auth-card__header">
                <h1 class="auth-card__title">Jack Endex Control Center</h1>
                <p class="auth-card__subtitle">Sign in to continue to your campaigns</p>
            </header>
            <div class="auth-card__actions">
                <button type="button" class="button" @click="startDiscordSignIn">
                    Sign in with Discord
                </button>
                <p class="auth-card__hint">You'll be redirected to Discord to authorize your account.</p>
            </div>
        </section>
    </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import LoadingBar from '../components/LoadingBar.vue';
import { Auth } from '../api';

const route = useRoute();

const redirectTarget = computed(() => {
    const redirect = route.query.redirect;
    if (typeof redirect === 'string' && redirect.trim()) {
        return redirect;
    }
    return '/';
});

const discordSignInUrl = computed(() => Auth.discordStartUrl({ redirect: redirectTarget.value }));

function startDiscordSignIn() {
    window.location.href = discordSignInUrl.value;
}
</script>

<style scoped>
.auth-view {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: clamp(1.5rem, 4vw, 3.5rem);
    background: radial-gradient(circle at top left, rgba(15, 50, 110, 0.9), rgba(4, 9, 25, 0.98));
    color: #f5f9ff;
}

.auth-card {
    width: clamp(320px, 90vw, 520px);
    background: rgba(8, 12, 26, 0.85);
    border-radius: clamp(1.75rem, 3vw, 2.5rem);
    box-shadow: 0 25px 50px rgba(4, 20, 45, 0.55);
    padding: clamp(1.75rem, 4vw, 3rem);
    display: flex;
    flex-direction: column;
    gap: clamp(1.5rem, 3vw, 2.5rem);
}

.auth-card__header {
    display: flex;
    flex-direction: column;
    gap: clamp(0.5rem, 1vw, 0.75rem);
    text-align: center;
}

.auth-card__title {
    margin: 0;
    font-size: clamp(2rem, 1.5vw + 1.5rem, 2.75rem);
    font-weight: 700;
}

.auth-card__subtitle {
    margin: 0;
    font-size: clamp(0.95rem, 0.5vw + 0.85rem, 1.1rem);
    color: rgba(255, 255, 255, 0.75);
}

.auth-card__actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(1rem, 2vw, 1.5rem);
}

.button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.65rem;
    padding: clamp(0.8rem, 1vw + 0.7rem, 1.05rem) clamp(2rem, 1.5vw + 1.5rem, 2.75rem);
    border: none;
    border-radius: clamp(1rem, 2vw, 1.4rem);
    font-size: clamp(1rem, 0.5vw + 0.95rem, 1.15rem);
    font-weight: 600;
    color: #0b1120;
    background: linear-gradient(135deg, #6a8cff, #5865f2);
    box-shadow: 0 16px 36px rgba(88, 101, 242, 0.35);
    cursor: pointer;
    transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.button:hover {
    transform: translateY(-1px);
    box-shadow: 0 20px 40px rgba(88, 101, 242, 0.45);
}

.button:active {
    transform: translateY(0);
    box-shadow: 0 12px 28px rgba(88, 101, 242, 0.3);
}

.button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.6), 0 0 0 6px rgba(88, 101, 242, 0.4);
}

.button:disabled {
    opacity: 0.7;
    cursor: not-allowed;
    transform: none;
    box-shadow: 0 12px 28px rgba(88, 101, 242, 0.25);
}

.auth-card__hint {
    margin: 0;
    text-align: center;
    font-size: clamp(0.9rem, 0.4vw + 0.85rem, 1rem);
    color: rgba(255, 255, 255, 0.75);
    max-width: 32ch;
}

@media (max-width: 600px) {
    .auth-view {
        padding: clamp(1rem, 6vw, 2rem);
    }

    .auth-card {
        padding: clamp(1.25rem, 6vw, 2rem);
        gap: clamp(1.25rem, 5vw, 2rem);
    }

    .button {
        width: 100%;
    }
}
</style>
