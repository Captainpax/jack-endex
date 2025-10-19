<template>
    <div class="auth-view">
        <LoadingBar />
        <section class="auth-card">
            <header class="auth-card__header">
                <h1 class="auth-card__title">Jack Endex Control Center</h1>
                <p class="auth-card__subtitle">Sign in to continue to your campaigns</p>
            </header>
            <div class="auth-card__forms">
                <div class="auth-card__panels">
                    <form class="auth-form" @submit.prevent="handleLogin">
                        <header class="auth-form__header">
                            <h2 class="auth-form__title">Sign in</h2>
                        </header>
                        <label class="auth-form__field">
                            <span>Username</span>
                            <input type="text" v-model="loginUsername" autocomplete="username" required />
                        </label>
                        <label class="auth-form__field">
                            <span>Password</span>
                            <input type="password" v-model="loginPassword" autocomplete="current-password" required />
                        </label>
                        <p v-if="loginError" class="auth-form__error">{{ loginError }}</p>
                        <button type="submit" class="button" :disabled="loginBusy">
                            {{ loginBusy ? 'Signing in…' : 'Sign in' }}
                        </button>
                    </form>
                    <div class="auth-divider" aria-hidden="true">
                        <span>or</span>
                    </div>
                    <form class="auth-form" @submit.prevent="handleRegister">
                        <header class="auth-form__header">
                            <h2 class="auth-form__title">Create account</h2>
                        </header>
                        <label class="auth-form__field">
                            <span>Username</span>
                            <input type="text" v-model="registerUsername" autocomplete="new-username" required />
                        </label>
                        <label class="auth-form__field">
                            <span>Email</span>
                            <input type="email" v-model="registerEmail" autocomplete="email" required />
                        </label>
                        <label class="auth-form__field">
                            <span>Password</span>
                            <input type="password" v-model="registerPassword" autocomplete="new-password" required />
                        </label>
                        <label class="auth-form__field">
                            <span>Confirm password</span>
                            <input type="password" v-model="registerConfirm" autocomplete="new-password" required />
                        </label>
                        <p v-if="registerError" class="auth-form__error">{{ registerError }}</p>
                        <button type="submit" class="button" :disabled="registerBusy">
                            {{ registerBusy ? 'Creating account…' : 'Create account' }}
                        </button>
                    </form>
                </div>
            </div>
        </section>
    </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import LoadingBar from '../components/LoadingBar.vue';
import { Auth } from '../api';
import { useAuthStore } from '../composables/useAuthStore';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

const loginUsername = ref('');
const loginPassword = ref('');
const loginBusy = ref(false);
const loginError = ref('');

const registerUsername = ref('');
const registerEmail = ref('');
const registerPassword = ref('');
const registerConfirm = ref('');
const registerBusy = ref(false);
const registerError = ref('');

const redirectTarget = computed(() => {
    const redirect = route.query.redirect;
    if (typeof redirect === 'string' && redirect.trim()) {
        return redirect;
    }
    return '/';
});

function resolveErrorMessage(err, fallback) {
    return (
        err?.response?.data?.message ||
        err?.message ||
        fallback
    );
}

async function afterAuthSuccess() {
    await auth.fetchSession({ force: true });
    await router.replace(redirectTarget.value);
}

async function handleLogin() {
    loginError.value = '';
    if (loginBusy.value) return;
    try {
        loginBusy.value = true;
        await Auth.login(loginUsername.value, loginPassword.value);
        await afterAuthSuccess();
    } catch (err) {
        console.error(err);
        loginError.value = resolveErrorMessage(err, 'Failed to sign in.');
    } finally {
        loginBusy.value = false;
    }
}

async function handleRegister() {
    registerError.value = '';
    if (registerBusy.value) return;
    if (registerPassword.value !== registerConfirm.value) {
        registerError.value = 'Passwords do not match.';
        return;
    }
    try {
        registerBusy.value = true;
        await Auth.register(
            registerUsername.value,
            registerPassword.value,
            registerEmail.value,
            registerConfirm.value,
        );
        await Auth.login(registerUsername.value, registerPassword.value);
        await afterAuthSuccess();
    } catch (err) {
        console.error(err);
        registerError.value = resolveErrorMessage(err, 'Failed to create account.');
    } finally {
        registerBusy.value = false;
    }
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
    --panel-gap: clamp(1.5rem, 4vw, 3rem);
    --form-padding: clamp(1.5rem, 3vw, 2.5rem);
    --form-radius: clamp(1rem, 2vw, 1.75rem);
    --heading-gap: clamp(0.35rem, 0.8vw, 0.65rem);
    --divider-spacing: clamp(1.5rem, 5vw, 3.25rem);
    width: clamp(320px, 90vw, 820px);
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

.auth-card__forms {
    width: 100%;
}

.auth-card__panels {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    column-gap: var(--panel-gap);
    row-gap: var(--panel-gap);
    align-items: stretch;
}

.auth-form {
    display: flex;
    flex-direction: column;
    gap: clamp(0.75rem, 1.5vw, 1.25rem);
    background: rgba(12, 17, 35, 0.8);
    padding: var(--form-padding);
    border-radius: var(--form-radius);
    box-shadow: inset 0 0 0 1px rgba(120, 175, 255, 0.15);
}

.auth-form__header {
    display: flex;
    flex-direction: column;
    gap: var(--heading-gap);
    margin-bottom: clamp(0.25rem, 0.5vw, 0.75rem);
}

.auth-form__title {
    margin: 0;
    font-size: clamp(1.35rem, 0.5vw + 1.2rem, 1.65rem);
    font-weight: 600;
}

.auth-form__field {
    display: flex;
    flex-direction: column;
    gap: clamp(0.35rem, 0.6vw, 0.6rem);
    font-size: clamp(0.95rem, 0.3vw + 0.85rem, 1.05rem);
}

.auth-form__field span {
    color: rgba(255, 255, 255, 0.75);
}

.auth-form__field input {
    padding: clamp(0.6rem, 1vw, 0.85rem) clamp(0.75rem, 1.5vw, 1.1rem);
    border-radius: clamp(0.85rem, 1.5vw, 1.15rem);
    border: 1px solid rgba(120, 175, 255, 0.25);
    background: rgba(8, 12, 26, 0.8);
    color: inherit;
    font: inherit;
}

.auth-form__field input:focus {
    outline: none;
    border-color: rgba(120, 175, 255, 0.65);
    box-shadow: 0 0 0 2px rgba(120, 175, 255, 0.3);
}

.auth-form__error {
    color: #ff8a8a;
    font-size: clamp(0.85rem, 0.3vw + 0.8rem, 0.95rem);
}

.auth-divider {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: clamp(2.25rem, 5vw, 3.25rem);
    min-height: 100%;
    color: rgba(255, 255, 255, 0.6);
    text-transform: uppercase;
    font-size: clamp(0.75rem, 0.3vw + 0.7rem, 0.85rem);
    font-weight: 600;
    letter-spacing: 0.18em;
}

.auth-divider::before {
    content: '';
    position: absolute;
    top: var(--divider-spacing);
    bottom: var(--divider-spacing);
    left: 50%;
    width: 1px;
    background: rgba(255, 255, 255, 0.2);
    transform: translateX(-50%);
}

.auth-divider span {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem 0.35rem;
    border-radius: 999px;
    background: rgba(12, 17, 35, 0.95);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12);
}

.button {
    align-self: flex-start;
    margin-top: clamp(0.25rem, 1vw, 0.75rem);
}

.button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

@media (max-width: 1024px) {
    .auth-card {
        --panel-gap: clamp(1.25rem, 4vw, 2.25rem);
        --divider-spacing: clamp(1.25rem, 4vw, 2.5rem);
    }

    .auth-card__title {
        font-size: clamp(1.85rem, 2vw + 1.1rem, 2.4rem);
    }
}

@media (max-width: 900px) {
    .auth-card__panels {
        grid-template-columns: minmax(0, 1fr);
    }

    .auth-divider {
        width: 100%;
        min-height: auto;
        padding-block: clamp(1rem, 3vw, 1.5rem);
        letter-spacing: 0.1em;
    }

    .auth-divider::before {
        top: 50%;
        bottom: auto;
        left: clamp(1.5rem, 6vw, 3rem);
        right: clamp(1.5rem, 6vw, 3rem);
        width: auto;
        height: 1px;
        transform: translateY(-50%);
    }

    .auth-divider span {
        padding: 0.25rem 0.65rem;
    }
}

@media (max-width: 600px) {
    .auth-view {
        padding: clamp(1rem, 6vw, 2rem);
    }

    .auth-card {
        padding: clamp(1.25rem, 6vw, 2rem);
        gap: clamp(1.25rem, 5vw, 2rem);
    }

    .auth-form {
        gap: clamp(0.65rem, 4vw, 1rem);
    }

    .button {
        width: 100%;
        align-self: stretch;
        text-align: center;
    }
}
</style>
