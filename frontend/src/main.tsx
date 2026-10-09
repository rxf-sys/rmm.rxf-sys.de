import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { createQueryClient } from './api/queryClient';
import { ErrorBoundary } from './components/ErrorBoundary';
// Selbst gehostete Fonts (Vite bündelt die woff2 nach dist/assets) — kein
// Google-Fonts-CDN, keine externe Abhängigkeit, CSP bleibt 'self'.
import '@fontsource-variable/manrope/index.css';
// Nur die Latein-Subsets: die vollen Einstiegspunkte ziehen zusätzlich
// Kyrillisch, Griechisch und Vietnamesisch ins Image — 30 Dateien statt 12,
// von denen ein deutsches Dashboard keine einzige je lädt.
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-ext-400.css';
import '@fontsource/ibm-plex-mono/latin-ext-500.css';
import '@fontsource/ibm-plex-mono/latin-ext-600.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/components.css';
import './styles/shell.css';
import './styles/boot.css';

const queryClient = createQueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* BrowserRouter, not HashRouter: Caddy already falls back to index.html
          for unknown paths (try_files), so real URLs work on reload. */}
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
