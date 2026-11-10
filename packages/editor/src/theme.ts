// Canvas drawing cannot read CSS variables by itself. This reads the tokens
// once into a plain object, which is passed to every draw function. So the
// tokens file stays the one place where colors and sizes live.

import { useEffect, useState } from 'react';

export type Theme = {
  surface: string;
  border: string;
  text: string;
  muted: string;
  shape: string;
  accent: string;
  accentSoft: string;
  original: string;
  grid: string;
  stage: string;
  fontUi: string;
  fontMono: string;
  textSmall: number;
};

export function readTheme(): Theme {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string): string => style.getPropertyValue(name).trim();
  return {
    surface: token('--color-surface'),
    border: token('--color-border'),
    text: token('--color-text'),
    muted: token('--color-text-muted'),
    shape: token('--color-shape'),
    accent: token('--color-accent'),
    accentSoft: token('--color-accent-soft'),
    original: token('--color-original'),
    grid: token('--color-grid'),
    stage: token('--color-stage'),
    fontUi: token('--font-ui'),
    fontMono: token('--font-mono'),
    textSmall: Number.parseFloat(token('--text-small')),
  };
}

// The current theme, read again when the system switches light and dark.
export function useTheme(): Theme {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (): void => setTheme(readTheme());
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return theme;
}
