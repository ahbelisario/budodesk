/** Piezas compartidas de clases */
import React from 'react';
import { Pressable, View } from 'react-native';
import type { Session } from '../../api/classes';
import { Badge, Text, type Tone } from '../../ui/primitives';
import { palette, radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { t } from '../../i18n';
import { hm } from '../../utils/format';

export const ct = (k: string, o?: Record<string, unknown>) => t(`classes.${k}`, o);

export function ageLabel(min?: number | null, max?: number | null) {
  if (min != null && max != null) return ct('ages', { min, max });
  if (min != null) return ct('agesFrom', { min });
  if (max != null) return ct('agesTo', { max });
  return null;
}

/** Cupo en texto: "6 de 12 · 2 en espera" */
export function spotsLabel(s: Pick<Session, 'capacity' | 'booked_count' | 'waitlist_count'>) {
  const parts = [s.capacity != null ? ct('spots', { booked: s.booked_count, capacity: s.capacity }) : `${s.booked_count}`];
  if (s.waitlist_count) parts.push(ct('waitlist', { count: s.waitlist_count }));
  return parts.join(' · ');
}

/** Estado de la reserva de la persona (para alumno/tutor) */
export function myBookingBadge(s: Session): { label: string; tone: Tone } | null {
  if (s.my_booking === 'booked') return { label: ct('booked'), tone: 'success' };
  if (s.my_booking === 'attended') return { label: ct('attended'), tone: 'success' };
  if (s.my_booking === 'waitlisted') return { label: ct('waitlisted', { pos: s.my_waitlist_position ?? '' }), tone: 'warning' };
  return null;
}

export function statusBadge(s: Pick<Session, 'status' | 'is_past'>): { label: string; tone: Tone } | null {
  if (s.status === 'cancelled') return { label: ct('cancelled'), tone: 'danger' };
  if (s.status === 'completed') return { label: ct('completed'), tone: 'neutral' };
  return null;
}

/** Tarjeta compacta para la vista semanal en pantalla ancha */
export function SessionBlock({ s, staff, onPress }: { s: Session; staff: boolean; onPress: () => void }) {
  const { accent } = useTheme();
  const st = statusBadge(s);
  const mine = staff ? null : myBookingBadge(s);
  const full = s.capacity != null && s.booked_count >= s.capacity;
  const dim = s.status === 'cancelled' || s.is_past;
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${s.title}, ${hm(s.start_time)}`} onPress={onPress}
      style={({ pressed }) => ({ borderRadius: radius.md, borderWidth: 1, borderColor: mine ? palette.success : palette.line, backgroundColor: pressed ? palette.paper : palette.surface,
        borderLeftWidth: 4, borderLeftColor: s.color ?? accent, padding: 8, gap: 2, opacity: dim ? 0.6 : 1 })}>
      <Text variant="caption" color={palette.ink2}>{hm(s.start_time)}–{hm(s.end_time)}</Text>
      <Text variant="smallStrong" numberOfLines={2} style={{ textDecorationLine: s.status === 'cancelled' ? 'line-through' : 'none' }}>{s.title}</Text>
      {s.instructor_name ? <Text variant="caption" color={palette.ink2} numberOfLines={1}>{s.instructor_name}</Text> : null}
      {st ? <Badge label={st.label} tone={st.tone} /> : mine ? <Badge label={mine.label} tone={mine.tone} />
        : <Text variant="caption" color={full ? palette.danger : palette.ink2}>{full ? ct('full') : spotsLabel(s)}</Text>}
    </Pressable>
  );
}

/** Selector de días de la semana (horarios) */
export function DayToggles({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
      {days.map((d) => {
        const on = value.includes(d);
        return (
          <Pressable key={d} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={ct(`day_${d}`)}
            onPress={() => onChange(on ? value.filter((x) => x !== d) : days.filter((x) => x === d || value.includes(x)))}
            style={{ width: 52, height: 40, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
              borderColor: on ? palette.ink : palette.line, backgroundColor: on ? palette.ink : palette.surface }}>
            <Text variant="smallStrong" color={on ? '#FFFFFF' : palette.ink}>{ct(`day_${d}`)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
