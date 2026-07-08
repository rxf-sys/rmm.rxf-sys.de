import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const KEY = 'vektor-theme';

function initial(): Theme {
  const stored = localStorage.getItem(KEY);
  return stored === 'light' ? 'light' : 'dark';
}

/** Theme state mirrored onto body[data-theme] and persisted in localStorage. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem(KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return { theme, toggle };
}
