import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const KEY = 'vulpexa-theme';
const LEGACY_KEY = 'ryntra-theme';

/** Weder Lesen noch Schreiben darf werfen: im privaten Fenster und bei
 *  blockierten Site-Daten wirft `localStorage` schon beim Zugriff — und ein
 *  Absturz wegen einer Farbeinstellung riss bisher die ganze Oberfläche mit. */
function initial(): Theme {
  try {
    const stored = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    return stored === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Theme state mirrored onto body[data-theme] and persisted in localStorage. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    document.body.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      // Die Einstellung überlebt dann den Reload nicht — kein Grund, hier
      // etwas kaputtgehen zu lassen.
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return { theme, toggle };
}
