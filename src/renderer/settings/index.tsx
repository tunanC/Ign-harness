import React from 'react';
import ReactDOM from 'react-dom/client';
import { SettingsApp } from './SettingsApp';
import '../framework/global.css';

// Apply saved theme before React renders (avoids dark→light flash)
const saved = localStorage.getItem('ign-theme');
if (saved === 'dark' || saved === 'light') {
  document.documentElement.setAttribute('data-theme', saved);
}

ReactDOM.createRoot(document.getElementById('base-root')!).render(
  <React.StrictMode>
    <SettingsApp />
  </React.StrictMode>,
);
