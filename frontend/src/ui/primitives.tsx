/**
 * Componentes base del diseño "Tinta y papel".
 * Todas las pantallas se construyen con estos; nada de colores sueltos.
 */
import React, { forwardRef, useState } from 'react';
import {
  ActivityIndicator, Pressable, Text as RNText, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTheme } from '../theme/ThemeProvider';
import { palette, radius, space, type, type TypeVariant, fonts } from '../theme/tokens';
import { API_URL } from '../config';

export type IconName = React.ComponentProps<typeof Feather>['name'];
export const Icon = ({ name, size = 20, color = palette.ink }: { name: IconName; size?: number; color?: string }) =>
  <Feather name={name} size={size} color={color} />;

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------
type TextProps = React.ComponentProps<typeof RNText> & { variant?: TypeVariant; color?: string; align?: TextStyle['textAlign'] };
export function Text({ variant = 'body', color = palette.ink, align, style, ...rest }: TextProps) {
  return <RNText {...rest} style={[type[variant], { color, textAlign: align }, style]} />;
}

// ---------------------------------------------------------------------------
// Botón
// ---------------------------------------------------------------------------
type ButtonVariant = 'primary' | 'dark' | 'secondary' | 'ghost' | 'danger';
type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  label: string;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  icon?: IconName;
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
};
export function Button({ label, variant = 'primary', size = 'md', icon, loading, fullWidth, disabled, style, ...rest }: ButtonProps) {
  const { accent, onAccent } = useTheme();
  const bg = { primary: accent, dark: palette.ink, secondary: palette.surface, ghost: 'transparent', danger: palette.surface }[variant];
  const fg = { primary: onAccent, dark: '#FFFFFF', secondary: palette.ink, ghost: palette.ink, danger: palette.danger }[variant];
  const border = { primary: accent, dark: palette.ink, secondary: palette.ink, ghost: 'transparent', danger: palette.line }[variant];
  const h = size === 'md' ? 44 : 36;
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      {...rest}
      style={({ pressed }) => [{
        height: h, paddingHorizontal: size === 'md' ? 18 : 14, borderRadius: size === 'md' ? radius.md : radius.pill,
        backgroundColor: bg, borderWidth: 1, borderColor: border,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        opacity: off ? 0.55 : pressed ? 0.85 : 1, alignSelf: fullWidth ? 'stretch' : 'auto',
      }, style]}
    >
      {loading ? <ActivityIndicator color={fg} size="small" /> : icon ? <Icon name={icon} size={18} color={fg} /> : null}
      <Text variant={size === 'md' ? 'bodyStrong' : 'smallStrong'} color={fg}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, badge }: { icon: IconName; label: string; onPress?: () => void; badge?: boolean }) {
  const { accent } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.line,
        backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}>
      <Icon name={icon} size={20} />
      {badge ? <View style={{ position: 'absolute', top: 9, right: 10, width: 9, height: 9, borderRadius: 9, backgroundColor: accent, borderWidth: 2, borderColor: palette.surface }} /> : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Tarjetas y estructura
// ---------------------------------------------------------------------------
export function Card({ children, dark, padding = space.lg, style }: { children: React.ReactNode; dark?: boolean; padding?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{
      backgroundColor: dark ? palette.ink : palette.surface, borderRadius: radius.lg, padding,
      borderWidth: dark ? 0 : 1, borderColor: palette.line, gap: space.sm,
    }, style]}>{children}</View>
  );
}

export function Divider({ dark }: { dark?: boolean }) {
  return <View style={{ height: 1, backgroundColor: dark ? palette.darkLine : palette.lineSoft }} />;
}

export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.sm }}>
      <Text variant="heading" accessibilityRole="header">{title}</Text>
      {action}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Insignias y progreso
// ---------------------------------------------------------------------------
export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'dark';
const TONES: Record<Tone, [string, string]> = {
  neutral: [palette.sunken, palette.ink2], success: [palette.successBg, palette.success], warning: [palette.warningBg, palette.warning],
  danger: [palette.dangerBg, palette.danger], info: [palette.infoBg, palette.info], dark: [palette.darkRaised, palette.inkOnDark],
};
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const [bg, fg] = TONES[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
      <Text variant="caption" color={fg} style={{ fontFamily: fonts.bodySemibold }}>{label}</Text>
    </View>
  );
}

export function ProgressBar({ value, color = palette.ink, track = palette.sunken, height = 6, label }: { value: number; color?: string; track?: string; height?: number; label?: string }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={{ height, backgroundColor: track, borderRadius: radius.pill, overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height, backgroundColor: color, borderRadius: radius.pill }} />
    </View>
  );
}

/**
 * Cinturón. En modo 'rank' (Aikido) es discreto; en 'belt' es protagonista.
 * La punta negra muestra los tips.
 */
export function Belt({ color, stripeColor, stripes = 0, size = 'md', onDark }: { color: string; stripeColor?: string | null; stripes?: number; size?: 'sm' | 'md' | 'lg'; onDark?: boolean }) {
  const dims = { sm: [48, 10], md: [72, 12], lg: [300, 22] }[size] as [number, number];
  const [w, h] = dims;
  const isWhite = /^#?f{6}$/i.test(color.replace('#', ''));
  const tipColor = /^#?(0{6}|111111|1a1a1a)$/i.test(color.replace('#', '')) ? '#B91C1C' : '#111111';
  return (
    <View accessible={false} style={{
      width: size === 'lg' ? '100%' : w, height: h, borderRadius: 3, backgroundColor: color, overflow: 'hidden',
      flexDirection: 'row', justifyContent: 'flex-end',
      borderWidth: isWhite && !onDark ? 1 : 0, borderColor: '#CFC9BB',
    }}>
      {stripeColor ? <View style={{ position: 'absolute', left: 0, right: 0, top: h / 3, height: h / 3, backgroundColor: stripeColor }} /> : null}
      {stripes > 0 || size === 'lg' ? (
        <View style={{ width: Math.max(h * 2, stripes * (h / 2) + h), backgroundColor: tipColor, flexDirection: 'row', alignItems: 'stretch', justifyContent: 'center', gap: Math.max(2, h / 5) }}>
          {Array.from({ length: stripes }).map((_, i) => <View key={i} style={{ width: Math.max(2, h / 4), backgroundColor: '#FFFFFF' }} />)}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------
export function Avatar({ name, photoUrl, size = 40 }: { name: string; photoUrl?: string | null; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
  const uri = photoUrl ? (photoUrl.startsWith('http') ? photoUrl : `${API_URL}${photoUrl}`) : null;
  return uri ? (
    <Image source={{ uri }} accessibilityLabel={name} style={{ width: size, height: size, borderRadius: size }} contentFit="cover" />
  ) : (
    <View accessibilityLabel={name} style={{ width: size, height: size, borderRadius: size, backgroundColor: '#E9E5DA', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: fonts.display, fontSize: size * 0.36 }} color={palette.ink2}>{initials || '?'}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Formularios
// ---------------------------------------------------------------------------
type FieldProps = TextInputProps & { label: string; error?: string | null; hint?: string; secureToggle?: boolean };
export const Field = forwardRef<TextInput, FieldProps>(function Field({ label, error, hint, secureToggle, secureTextEntry, style, ...rest }, ref) {
  const [hidden, setHidden] = useState(true);
  const { accent } = useTheme();
  const [focused, setFocused] = useState(false);
  const secure = secureToggle ? hidden : secureTextEntry;
  return (
    <View style={{ gap: 6 }}>
      <Text variant="smallStrong" nativeID={`${label}-label`}>{label}</Text>
      <View style={{
        flexDirection: 'row', alignItems: rest.multiline ? 'stretch' : 'center', height: rest.multiline ? undefined : 48, minHeight: 48, borderRadius: radius.md, backgroundColor: palette.surface,
        borderWidth: focused ? 2 : 1, borderColor: error ? palette.danger : focused ? accent : palette.line, paddingHorizontal: focused ? 13 : 14,
      }}>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          aria-labelledby={`${label}-label`}
          placeholderTextColor={palette.ink3}
          secureTextEntry={secure}
          onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
          {...rest}
          style={[{ flex: 1, minWidth: 0, height: rest.multiline ? undefined : '100%', fontFamily: fonts.body, fontSize: 16, color: palette.ink, outlineWidth: 0 } as TextStyle, style]}
        />
        {secureToggle ? (
          <Pressable accessibilityRole="button" accessibilityLabel={hidden ? 'Mostrar contraseña' : 'Ocultar contraseña'}
            onPress={() => setHidden((h) => !h)} hitSlop={10} style={{ padding: 6 }}>
            <Icon name={hidden ? 'eye' : 'eye-off'} size={18} color={palette.ink2} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text variant="small" color={palette.danger} accessibilityLiveRegion="polite">{error}</Text>
        : hint ? <Text variant="small" color={palette.ink2}>{hint}</Text> : null}
    </View>
  );
});

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------
export function Notice({ tone = 'info', title, children }: { tone?: Exclude<Tone, 'dark'>; title?: string; children?: React.ReactNode }) {
  const [bg, fg] = TONES[tone];
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: bg, borderRadius: radius.md, padding: space.md, gap: 4 }}>
      {title ? <Text variant="bodyStrong" color={fg}>{title}</Text> : null}
      {typeof children === 'string' ? <Text variant="small" color={fg}>{children}</Text> : children}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={{ flex: 1, minHeight: 200, alignItems: 'center', justifyContent: 'center', gap: space.sm }}>
      <ActivityIndicator color={palette.ink} />
      {label ? <Text variant="small" color={palette.ink2}>{label}</Text> : null}
    </View>
  );
}

export function EmptyState({ icon = 'inbox', title, body, action }: { icon?: IconName; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <View style={{ alignItems: 'center', padding: space.xl, gap: space.sm }}>
      <View style={{ width: 56, height: 56, borderRadius: 56, backgroundColor: palette.sunken, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={24} color={palette.ink2} />
      </View>
      <Text variant="heading" align="center">{title}</Text>
      {body ? <Text variant="small" color={palette.ink2} align="center" style={{ maxWidth: 360 }}>{body}</Text> : null}
      {action}
    </View>
  );
}
