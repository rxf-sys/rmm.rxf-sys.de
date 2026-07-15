import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Selbst gehostete Fonts (Vite bündelt die woff2 nach dist/assets) — kein
// Google-Fonts-CDN, keine externe Abhängigkeit, CSP bleibt 'self'.
import '@fontsource-variable/manrope/index.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
