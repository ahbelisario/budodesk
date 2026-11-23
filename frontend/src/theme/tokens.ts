/**
 * "Tinta y papel" — fondo washi, texto tinta, un solo acento (el color del dojo).
 * Todos los colores de texto cumplen contraste AA sobre `paper` y `surface`.
 */
export const palette = {
  paper: '#F6F4EF',      // fondo general
  surface: '#FFFFFF',    // tarjetas
  sunken: '#EFECE4',     // pistas de barras, fondos hundidos
  line: '#E4E0D6',       // bordes
  lineSoft: '#EFECE4',   // separadores dentro de tarjetas
  ink: '#1A1A1A',        // texto principal / superficies oscuras
  ink2: '#4A4A45',       // texto secundario (8:1 sobre paper)
  ink3: '#6B6A63',       // texto terciario (5:1)
  inkOnDark: '#F6F4EF',
  mutedOnDark: '#BDB9AE',
  darkRaised: '#2B2B29',
  darkLine: '#3A3A37',

  success: '#166534', successBg: '#DCFCE7',
  warning: '#92400E', warningBg: '#FEF3C7',
  danger: '#9F1239', dangerBg: '#FFE4E6',
  info: '#1E3A8A', infoBg: '#DBEAFE',
};

export const DEFAULT_ACCENT = '#B91C1C';

export const fonts = {
  display: 'ZenKakuGothicNew_700Bold',
  displayMedium: 'ZenKakuGothicNew_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
};

export const space = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
export const radius = { sm: 8, md: 10, lg: 14, xl: 20, pill: 999 } as const;

export const type = {
  display: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38 },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30 },
  heading: { fontFamily: fonts.display, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  bodyStrong: { fontFamily: fonts.bodySemibold, fontSize: 14, lineHeight: 20 },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  smallStrong: { fontFamily: fonts.bodySemibold, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.bodyMedium, fontSize: 12, lineHeight: 16 },
  overline: { fontFamily: fonts.bodySemibold, fontSize: 12, lineHeight: 16, letterSpacing: 0.9, textTransform: 'uppercase' as const },
  number: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36 },
};

export type TypeVariant = keyof typeof type;

/** Ancho a partir del cual se usa la barra lateral en lugar de pestañas */
export const WIDE_BREAKPOINT = 900;

/** Texto legible sobre un color de fondo arbitrario (para el acento del dojo) */
export function onColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#FFFFFF';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.4 ? palette.ink : '#FFFFFF';
}
