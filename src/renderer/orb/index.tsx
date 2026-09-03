import { createRoot } from 'react-dom/client';
import { OrbApp } from './OrbApp';
import '../framework/global.css';

// Apply saved theme before React renders (CSS vars correct for Three.js init)
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

const root = document.getElementById('root');
if (root) createRoot(root).render(<OrbApp />);
