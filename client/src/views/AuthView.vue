<template>
    <div class="auth-view">
        <LoadingBar />
        <section class="auth-card">
            <header class="auth-card__header">
                <h1 class="auth-card__title">Jack Endex Control Center</h1>
                <p class="auth-card__subtitle">Sign in to continue to your campaigns</p>
            </header>
            <div class="auth-card__forms">
                <form class="auth-form" @submit.prevent="handleLogin">
                    <h2 class="auth-form__title">Sign in</h2>
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
                <div class="auth-divider">
                    <span>or</span>
                </div>
                <form class="auth-form" @submit.prevent="handleRegister">
                    <h2 class="auth-form__title">Create account</h2>
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
    padding: 2rem;
    background: radial-gradient(circle at top left, rgba(15, 50, 110, 0.9), rgba(4, 9, 25, 0.98));
    color: #f5f9ff;
}

.auth-card {
    width: min(900px, 100%);
    background: rgba(8, 12, 26, 0.85);
    border-radius: 2rem;
    box-shadow: 0 25px 50px rgba(4, 20, 45, 0.55);
    padding: 2.5rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
}

.auth-card__header {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    text-align: center;
}

.auth-card__title {
    margin: 0;
    font-size: 2.25rem;
    font-weight: 700;
}

.auth-card__subtitle {
    margin: 0;
    font-size: 1rem;
    color: rgba(255, 255, 255, 0.75);
}

.auth-card__forms {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2rem;
    align-items: start;
}

.auth-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    background: rgba(12, 17, 35, 0.8);
    padding: 1.75rem;
    border-radius: 1.25rem;
    box-shadow: inset 0 0 0 1px rgba(120, 175, 255, 0.15);
}

.auth-form__title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
}

.auth-form__field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.95rem;
}

.auth-form__field span {
    color: rgba(255, 255, 255, 0.75);
}

.auth-form__field input {
    padding: 0.6rem 0.75rem;
    border-radius: 0.85rem;
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
    font-size: 0.9rem;
}

.auth-divider {
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.6);
    text-transform: uppercase;
    font-size: 0.85rem;
    font-weight: 600;
}

.auth-divider::before,
.auth-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: rgba(255, 255, 255, 0.2);
    margin: 0 1rem;
}

.button {
    align-self: flex-start;
}

.button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

@media (max-width: 920px) {
    .auth-card__forms {
        grid-template-columns: 1fr;
    }

    .auth-divider {
        margin: -1rem 0;
    }
}
</style>
