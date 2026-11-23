/**
 * Controles de formulario y navegación interna: Select, DateField, Tabs,
 * FilterChips, SearchField, SwitchRow, FormGrid.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, Switch, TextInput, View, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, radius, space, fonts } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { Field, Icon, Text } from './primitives';
import { useIsWide } from '../navigation/AppShell';
import { getLanguage } from '../i18n';

// ---------------------------------------------------------------------------
// Select (lista en un modal; con búsqueda si hay muchas opciones)
// ---------------------------------------------------------------------------
export type Option<V extends string | number> = { value: V; label: string; hint?: string; color?: string };

export function Select<V extends string | number>({
  label, value, options, onChange, placeholder, error, allowClear, disabled,
}: {
  label: string; value: V | null | undefined; options: Option<V>[]; onChange: (v: V | null) => void;
  placeholder?: string; error?: string | null; allowClear?: boolean; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const insets = useSafeAreaInsets();
  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? options.filter((o) => o.label.toLowerCase().includes(n)) : options;
  }, [q, options]);
  const es = getLanguage() !== 'en';

  return (
    <View style={{ gap: 6 }}>
      <Text variant="smallStrong">{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${selected?.label ?? placeholder ?? ''}`} disabled={disabled}
        onPress={() => { setQ(''); setOpen(true); }}
        style={{ height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: error ? palette.danger : palette.line, backgroundColor: disabled ? palette.sunken : palette.surface,
          paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {selected?.color ? <View style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: selected.color, borderWidth: 1, borderColor: '#CFC9BB' }} /> : null}
        <Text style={{ flex: 1, fontSize: 16 }} color={selected ? palette.ink : palette.ink3} numberOfLines={1}>{selected?.label ?? placeholder ?? (es ? 'Selecciona…' : 'Select…')}</Text>
        <Icon name="chevron-down" size={18} color={palette.ink2} />
      </Pressable>
      {error ? <Text variant="small" color={palette.danger}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(26,26,26,0.45)', justifyContent: 'center', padding: space.lg }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: palette.surface, borderRadius: radius.xl, maxHeight: '80%', width: '100%', maxWidth: 440, alignSelf: 'center', overflow: 'hidden', marginBottom: insets.bottom }}>
            <View style={{ padding: space.md, gap: space.sm, borderBottomWidth: 1, borderBottomColor: palette.lineSoft }}>
              <Text variant="heading">{label}</Text>
              {options.length > 8 ? (
                <TextInput value={q} onChangeText={setQ} placeholder={es ? 'Buscar…' : 'Search…'} placeholderTextColor={palette.ink3} autoFocus
                  style={{ height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 12, fontFamily: fonts.body, fontSize: 16, color: palette.ink, outlineWidth: 0 } as TextStyle} />
              ) : null}
            </View>
            <FlatList
              data={filtered}
              keyExtractor={(o) => String(o.value)}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={allowClear && value != null ? (
                <Pressable accessibilityRole="button" onPress={() => { onChange(null); setOpen(false); }} style={{ padding: space.md }}>
                  <Text color={palette.ink2}>{es ? 'Sin selección' : 'None'}</Text>
                </Pressable>
              ) : null}
              renderItem={({ item }) => {
                const on = item.value === value;
                return (
                  <Pressable accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => { onChange(item.value); setOpen(false); }}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: space.md, minHeight: 52, backgroundColor: pressed ? palette.paper : 'transparent' })}>
                    {item.color ? <View style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: item.color, borderWidth: 1, borderColor: '#CFC9BB' }} /> : null}
                    <View style={{ flex: 1 }}>
                      <Text variant={on ? 'bodyStrong' : 'body'}>{item.label}</Text>
                      {item.hint ? <Text variant="caption" color={palette.ink2}>{item.hint}</Text> : null}
                    </View>
                    {on ? <Icon name="check" size={18} /> : null}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Fecha (AAAA-MM-DD). En web usa el selector nativo del navegador.
// ---------------------------------------------------------------------------
export function isValidDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function DateField({ label, value, onChange, error, hint }: { label: string; value: string | null | undefined; onChange: (v: string | null) => void; error?: string | null; hint?: string }) {
  const [text, setText] = useState(value ?? '');
  const [touched, setTouched] = useState(false);
  React.useEffect(() => { setText(value ?? ''); }, [value]);
  const invalid = touched && text !== '' && !isValidDate(text);
  const es = getLanguage() !== 'en';

  // Web: <input type="date"> da un calendario sin dependencias extra
  if (typeof document !== 'undefined') {
    return (
      <View style={{ gap: 6 }}>
        <Text variant="smallStrong">{label}</Text>
        {React.createElement('input', {
          type: 'date', value: value ?? '', 'aria-label': label,
          onChange: (e: any) => onChange(e.target.value || null),
          style: { height: 48, borderRadius: radius.md, border: `1px solid ${error ? palette.danger : palette.line}`, padding: '0 14px',
            fontFamily: fonts.body, fontSize: 16, color: palette.ink, background: palette.surface, boxSizing: 'border-box', width: '100%' },
        })}
        {error ? <Text variant="small" color={palette.danger}>{error}</Text> : hint ? <Text variant="small" color={palette.ink2}>{hint}</Text> : null}
      </View>
    );
  }
  return (
    <Field label={label} value={text} placeholder={es ? 'AAAA-MM-DD' : 'YYYY-MM-DD'} keyboardType="numbers-and-punctuation" maxLength={10}
      onChangeText={(v) => {
        const clean = v.replace(/[^\d-]/g, '');
        setText(clean);
        if (clean === '') onChange(null);
        else if (isValidDate(clean)) onChange(clean);
      }}
      onBlur={() => setTouched(true)}
      error={error ?? (invalid ? (es ? 'Fecha inválida (AAAA-MM-DD)' : 'Invalid date (YYYY-MM-DD)') : null)} hint={hint} />
  );
}

// ---------------------------------------------------------------------------
// Pestañas
// ---------------------------------------------------------------------------
export function Tabs<K extends string>({ tabs, value, onChange }: { tabs: { key: K; label: string; badge?: number }[]; value: K; onChange: (k: K) => void }) {
  const { accent } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist"
      style={{ borderBottomWidth: 1, borderBottomColor: palette.line, flexGrow: 0 }} contentContainerStyle={{ gap: 4 }}>
      {tabs.map((tab) => {
        const on = tab.key === value;
        return (
          <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(tab.key)}
            style={{ height: 44, paddingHorizontal: 14, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 6,
              borderBottomWidth: 2, borderBottomColor: on ? accent : 'transparent', marginBottom: -1 }}>
            <Text variant={on ? 'bodyStrong' : 'body'} color={on ? palette.ink : palette.ink2}>{tab.label}</Text>
            {tab.badge ? <View style={{ backgroundColor: accent, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 }}><Text variant="caption" color="#FFFFFF">{tab.badge}</Text></View> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Chips de filtro
// ---------------------------------------------------------------------------
export function FilterChips<K extends string>({ options, value, onChange, label }: { options: { key: K; label: string }[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange(o.key)}
            style={{ height: 36, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, justifyContent: 'center',
              borderColor: on ? palette.ink : palette.line, backgroundColor: on ? palette.ink : palette.surface }}>
            <Text variant="smallStrong" color={on ? '#FFFFFF' : palette.ink}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Búsqueda
// ---------------------------------------------------------------------------
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line,
      backgroundColor: palette.surface, paddingHorizontal: 12, flexGrow: 1, minWidth: 220 }}>
      <Icon name="search" size={18} color={palette.ink3} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={palette.ink3} accessibilityLabel={placeholder}
        autoCorrect={false} autoCapitalize="none" returnKeyType="search"
        style={{ flex: 1, height: '100%', fontFamily: fonts.body, fontSize: 15, color: palette.ink, outlineWidth: 0 } as TextStyle} />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Limpiar" onPress={() => onChange('')} hitSlop={8}>
          <Icon name="x" size={16} color={palette.ink2} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Interruptor con etiqueta
// ---------------------------------------------------------------------------
export function SwitchRow({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { accent } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{label}</Text>
        {hint ? <Text variant="small" color={palette.ink2}>{hint}</Text> : null}
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} disabled={disabled}
        trackColor={{ true: accent, false: '#D9D4C8' }} thumbColor="#FFFFFF" {...({ activeThumbColor: '#FFFFFF' } as object)} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Rejilla de formulario: 2 columnas en pantallas anchas, 1 en celular
// ---------------------------------------------------------------------------
export function FormGrid({ children }: { children: React.ReactNode }) {
  const wide = useIsWide();
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
      {items.map((c, i) => <View key={i} style={{ flexGrow: 1, flexShrink: 1, flexBasis: wide ? 280 : '100%', minWidth: 0 }}>{c}</View>)}
    </View>
  );
}
