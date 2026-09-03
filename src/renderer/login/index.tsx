import React from 'react';
import ReactDOM from 'react-dom/client';
import { LoginApp } from './LoginApp';
import '../framework/global.css';

ReactDOM.createRoot(document.getElementById('base-root')!).render(
  <React.StrictMode>
    <LoginApp />
  </React.StrictMode>,
);
