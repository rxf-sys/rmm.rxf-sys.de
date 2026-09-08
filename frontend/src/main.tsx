import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
// Selbst gehostete Fonts (Vite bündelt die woff2 nach dist/assets) — kein
// Google-Fonts-CDN, keine externe Abhängigkeit, CSP bleibt 'self'.
import '@fontsource-variable/manrope/index.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* BrowserRouter, not HashRouter: Caddy already falls back to index.html
        for unknown paths (try_files), so real URLs work on reload. */}
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
