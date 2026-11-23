/** Piezas pequeñas compartidas por la lista y la ficha de miembros */
import React from 'react';
import { View } from 'react-native';
import type { RankBadge } from '../../api/types';
import type { MemberStatus } from '../../api/members';
import { Badge, Belt, Text, type Tone } from '../../ui/primitives';
import { palette, radius } from '../../theme/tokens';
import { t } from '../../i18n';

/** Grado compacto. 'rank' → texto ("5° Kyu"); 'belt' → cinta + nombre */
export function RankChip({ r, showDiscipline }: { r: Pick<RankBadge, 'rank' | 'color' | 'stripe_color' | 'stripes' | 'display_style' | 'discipline'>; showDiscipline?: boolean }) {
  const label = `${showDiscipline ? `${r.discipline} · ` : ''}${r.rank}`;
  if (r.display_style === 'belt') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
        <Belt size="sm" color={r.color} stripeColor={r.stripe_color} stripes={r.stripes} />
        <Text variant="small" color={palette.ink2} numberOfLines={1} style={{ flexShrink: 1 }}>{label}</Text>
      </View>
    );
  }
  return (
    <View style={{ borderWidth: 1, borderColor: palette.line, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 2, flexShrink: 1, alignSelf: 'flex-start' }}>
      <Text variant="small" color={palette.ink} numberOfLines={1}>{label}{r.stripes ? ` · ${'▮'.repeat(Math.min(r.stripes, 6))}` : ''}</Text>
    </View>
  );
}

const STATUS_TONE: Record<MemberStatus, Tone> = { pending: 'warning', active: 'success', inactive: 'neutral', suspended: 'danger' };
export function StatusBadge({ status }: { status: MemberStatus }) {
  return <Badge label={t(`members.st_${status}`)} tone={STATUS_TONE[status]} />;
}

export const mt = (k: string, o?: Record<string, unknown>) => t(`members.${k}`, o);
