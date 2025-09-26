import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import LoadingBar from './components/LoadingBar';
import './style.css';

// Force dark theme
if (typeof document !== 'undefined') {
    document.documentElement.classList.add('theme-dark');
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <LoadingBar />
        <App />
    </React.StrictMode>,
);

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js').catch((error) => {
            console.error('Service worker registration failed:', error);
        });
    });
}