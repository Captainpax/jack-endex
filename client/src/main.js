import { createApp } from 'vue';
import App from './App.vue';
import LoadingBar from './components/LoadingBar.vue';
import './style.css';

const darkThemePlugin = {
    install() {
        if (typeof document !== 'undefined') {
            document.documentElement.classList.add('theme-dark');
        }
    },
};

const app = createApp(App);

app.use(darkThemePlugin);
app.component('LoadingBar', LoadingBar);

app.mount('#root');

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').catch((error) => {
            console.error('Service worker registration failed:', error);
        });
    });
}
