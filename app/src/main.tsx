// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { init } from '@plausible-analytics/tracker';
import App from './App';
import { adoptCodeFromUrl } from './mcp/codeStore';
import './styles/theme.css';
import './styles/globals.css';

init({ domain: 'starquix.netlify.app' });

// `starquix-mcp pair` opens the app with ?mcp=<code>; park it before React mounts.
adoptCodeFromUrl();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
