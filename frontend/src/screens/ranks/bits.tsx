/** Piezas compartidas de grados y exámenes */
import React from 'react';
import { Pressable, View } from 'react-native';
import type { DisplayStyle } from '../../api/types';
import type { CandidateStatus, ExamStatus } from '../../api/ranks';
import { Badge, Belt, Field, Text, type Tone } from '../../ui/primitives';
import { palette, radius } from '../../theme/tokens';
import { t } from '../../i18n';

export const rt = (k: string, o?: Record<string, unknown>) => t(`ranks.${k}`, o);

export function ageRange(min?: number | null, max?: number | null) {
  if (min != null && max != null) return rt('agesRange', { min, max });
  if (min != null) return rt('agesFrom', { min });
  if (max != null) return rt('agesTo', { max });
  return null;
}

/** Grado según cómo lo muestra su programa: por nombre o con cinta de color */
export function RankView({ name, color, stripeColor, stripes = 0, style, size = 'md' }: {
  name: string; color: string; stripeColor?: string | null; stripes?: number; style: DisplayStyle; size?: 'sm' | 'md';
}) {
  if (style === 'belt') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
        <Belt size="sm" color={color} stripeColor={stripeColor} stripes={stripes} />
        <Text variant={size === 'sm' ? 'small' : 'bodyStrong'} numberOfLines={1} style={{ flexShrink: 1 }}>{name}</Text>
      </View>
    );
  }
  return (
    <View style={{ borderWidth: 1, borderColor: palette.line, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start', flexShrink: 1 }}>
      <Text variant={size === 'sm' ? 'small' : 'bodyStrong'} numberOfLines={1}>{name}{stripes ? ` · ${'▮'.repeat(Math.min(stripes, 6))}` : ''}</Text>
    </View>
  );
}

const EXAM_TONE: Record<ExamStatus, Tone> = { planned: 'neutral', open: 'success', closed: 'warning', completed: 'info', cancelled: 'danger' };
export const ExamStatusBadge = ({ status }: { status: ExamStatus }) => <Badge label={rt(`st_${status}`)} tone={EXAM_TONE[status]} />;

const CAND_TONE: Record<CandidateStatus, Tone> = { registered: 'neutral', passed: 'success', failed: 'danger', absent: 'warning', withdrawn: 'neutral' };
export const CandidateBadge = ({ status }: { status: CandidateStatus }) => <Badge label={rt(`c_${status}`)} tone={CAND_TONE[status]} />;

/** Colores típicos de cintas */
const SWATCHES = ['#FFFFFF', '#F2C200', '#F28C28', '#D7262E', '#2E8B57', '#1F5FAD', '#6B3FA0', '#7B4A2A', '#1A1A1A'];

export function ColorField({ label, value, onChange, error, allowEmpty }: { label: string; value: string | null; onChange: (v: string | null) => void; error?: string | null; allowEmpty?: boolean }) {
  return (
    <View style={{ gap: 6 }}>
      <Field label={label} value={value ?? ''} onChangeText={(v) => { const c = v.trim(); onChange(c === '' && allowEmpty ? null : c); }}
        autoCapitalize="characters" maxLength={7} placeholder="#RRGGBB" error={error} hint={rt('f_colorHint')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {SWATCHES.map((c) => (
          <Pressable key={c} accessibilityRole="button" accessibilityLabel={c} onPress={() => onChange(c)}
            style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: c, borderWidth: value?.toUpperCase() === c ? 3 : 1, borderColor: value?.toUpperCase() === c ? palette.ink : '#CFC9BB' }} />
        ))}
      </View>
    </View>
  );
}

export const isHex = (s: string | null | undefined) => !!s && /^#[0-9A-Fa-f]{6}$/.test(s);
export const toInt = (s: string) => (s.trim() === '' ? null : Number.parseInt(s, 10));
export const numStr = (n: number | null | undefined) => (n == null ? '' : String(n));
