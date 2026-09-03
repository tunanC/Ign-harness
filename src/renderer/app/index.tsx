import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import '../framework/global.css';

// Apply saved theme before React renders
const saved = localStorage.getItem('ign-theme');
if (saved === 'dark' || saved === 'light') {
  document.documentElement.setAttribute('data-theme', saved);
}

// React to theme changes from other windows (Settings)
window.addEventListener('storage', (e) => {
  if (e.key === 'ign-theme' && (e.newValue === 'dark' || e.newValue === 'light')) {
    document.documentElement.setAttribute('data-theme', e.newValue);
  }
});

ReactDOM.createRoot(document.getElementById('base-root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
