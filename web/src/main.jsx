import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import MatrixRain from './MatrixRain';
import './style.css';

// Force dark theme
if (typeof document !== 'undefined') {
  document.documentElement.classList.add('theme-dark');
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MatrixRain />
    <App />
  </React.StrictMode>,
);

