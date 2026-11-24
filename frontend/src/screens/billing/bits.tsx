/** Piezas compartidas de membresías y cobranza */
import React from 'react';
import { View } from 'react-native';
import type { MembershipStatus, Plan } from '../../api/billing';
import { Badge, Text, type Tone } from '../../ui/primitives';
import { palette } from '../../theme/tokens';
import { t } from '../../i18n';
import { dayShort, money } from '../../utils/format';

export const bt = (k: string, o?: Record<string, unknown>) => t(`billing.${k}`, o);

const MS_TONE: Record<MembershipStatus, Tone> = { pending: 'info', active: 'success', paused: 'warning', past_due: 'danger', cancelled: 'neutral', expired: 'neutral' };
export function MsStatus({ status }: { status: MembershipStatus }) {
  return <Badge label={bt(`st_${status}`)} tone={MS_TONE[status] ?? 'neutral'} />;
}

const CH_TONE: Record<string, Tone> = { pending: 'warning', partial: 'warning', paid: 'success', void: 'neutral', refunded: 'neutral' };
export function ChargeStatus({ status, due, today }: { status: string; due?: string; today?: string }) {
  const overdue = (status === 'pending' || status === 'partial') && due && today && due < today;
  return <Badge label={overdue ? bt('overdue') : t(`members.ch_${status}`)} tone={overdue ? 'danger' : CH_TONE[status] ?? 'neutral'} />;
}

/** "mensual", "cada 3 meses", "Paquete de 10 clases"… */
export function planCycle(p: Pick<Plan, 'billing_type' | 'interval_unit' | 'interval_count'> & Partial<Pick<Plan, 'total_sessions'>>) {
  if (p.billing_type === 'recurring' && p.interval_unit) return bt(`every_${p.interval_unit}`, { count: p.interval_count || 1 });
  if (p.billing_type === 'class_pack') return `${bt('bt_class_pack')}${p.total_sessions ? ` · ${p.total_sessions}` : ''}`;
  return bt(`bt_${p.billing_type}`);
}

export function PlanLine({ p }: { p: Plan }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="bodyStrong">{money(p.price, p.currency)} <Text variant="small" color={palette.ink2}>· {planCycle(p)}</Text></Text>
      <Text variant="caption" color={palette.ink2}>
        {[p.max_members > 1 ? bt('family', { count: p.max_members }) : null,
          p.sessions_per_week ? bt('perWeek', { count: p.sessions_per_week }) : null,
          p.signup_fee ? bt('signupFee', { amount: money(p.signup_fee, p.currency) }) : null].filter(Boolean).join(' · ')}
      </Text>
    </View>
  );
}

/** Mes actual y anterior en AAAA-MM-DD (hora local) */
export function monthRange(offset = 0) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: f(first), to: f(last) };
}

export function dueLabel(due: string, today: string, open: boolean) {
  if (!open) return dayShort(due);
  if (due < today) return bt('overdueSince', { date: dayShort(due) });
  if (due === today) return bt('dueToday');
  return bt('due', { date: dayShort(due) });
}

export function Tile({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <View style={{ gap: 2, flexGrow: 1, flexBasis: 180, minWidth: 0 }}>
      <Text variant="small" color={palette.ink2}>{label}</Text>
      <Text variant="number" color={tone ?? palette.ink}>{value}</Text>
      {hint ? <Text variant="caption" color={palette.ink2}>{hint}</Text> : null}
    </View>
  );
}

