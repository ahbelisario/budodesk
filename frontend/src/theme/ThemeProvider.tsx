import React, { createContext, useContext, useMemo } from 'react';
import { DEFAULT_ACCENT, onColor, palette } from './tokens';

type Theme = {
  accent: string;
  onAccent: string;
  colors: typeof palette;
};

const ThemeContext = createContext<Theme>({ accent: DEFAULT_ACCENT, onAccent: '#FFFFFF', colors: palette });

/** El acento es el color principal del dojo activo (dojos.color_primary). */
export function ThemeProvider({ accent, children }: { accent?: string | null; children: React.ReactNode }) {
  const value = useMemo(() => {
    const a = accent && /^#[0-9a-f]{6}$/i.test(accent) ? accent : DEFAULT_ACCENT;
    return { accent: a, onAccent: onColor(a), colors: palette };
  }, [accent]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
