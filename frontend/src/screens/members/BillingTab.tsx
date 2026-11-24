/** Pestaña Membresía y pagos + diálogo "Registrar pago" (reutilizable) */
import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { membersApi, type Charge } from '../../api/members';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Badge, Button, Card, Divider, EmptyState, Field, Loading, Notice, SectionHeader, Text, type Tone } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { Select } from '../../ui/forms';
import { palette, space } from '../../theme/tokens';
import { useIsWide } from '../../navigation/AppShell';
import { t } from '../../i18n';
import { dayShort, dayShortTs, money } from '../../utils/format';
import { mt } from './bits';
import { PersonPicker, type PickedPerson } from './PersonPicker';

const CH_TONE: Record<string, Tone> = { pending: 'warning', partial: 'warning', paid: 'success', void: 'neutral', refunded: 'neutral' };

/**
 * Registrar un pago manual. Sin userId, primero se elige a la persona
 * (y se sugiere su saldo pendiente).
 */
export function PaymentDialog({ visible, userId, name, suggested, onClose, onSaved }: {
  visible: boolean; userId?: number; name?: string; suggested?: number; onClose: () => void; onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'transfer' | 'card' | 'other'>('cash');
  const [reference, setReference] = useState('');
  const [who, setWho] = useState<PickedPerson | null>(null);
  const [owed, setOwed] = useState<number | undefined>(suggested);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  React.useEffect(() => {
    if (visible) { setAmount(suggested ? String(suggested) : ''); setReference(''); setErr(null); setMethod('cash'); setWho(null); setOwed(suggested); }
  }, [visible, suggested]);

  async function pick(p: PickedPerson | null) {
    setWho(p); setOwed(undefined); setAmount('');
    if (!p) return;
    try {
      const m = await membersApi.get(p.id);
      const due = Number(m.balance_due ?? 0);
      if (due > 0) { setOwed(due); setAmount(String(due)); }
    } catch { /* sin saldo sugerido */ }
  }

  const target = userId ?? who?.id;
  const n = Number(amount.replace(',', '.'));
  async function save() {
    if (!target) { setErr(t('billing.pickPersonFirst')); return; }
    if (!(n > 0)) { setErr(mt('required')); return; }
    setSaving(true); setErr(null);
    try {
      await membersApi.registerPayment({ user_id: target, amount: Math.round(n * 100) / 100, method, reference: reference.trim() || null });
      onSaved();
    } catch (e) { setErr(errorMessage(e)); } finally { setSaving(false); }
  }

  return (
    <Dialog visible={visible} onClose={onClose} title={name ? `${mt('registerPayment')} · ${name}` : mt('registerPayment')}
      actions={<>
        <Button label={t('common.cancel')} variant="ghost" onPress={onClose} />
        <Button label={mt('registerPayment')} icon="check" loading={saving} disabled={!target} onPress={save} />
      </>}>
      <View style={{ gap: space.md }}>
        {!userId ? <PersonPicker label={t('billing.person')} value={who} onChange={pick} /> : null}
        <Field label={mt('amount')} value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad"
          hint={owed ? `${mt('balance')}: ${money(owed)}` : undefined} />
        <Select label={mt('method')} value={method} onChange={(v) => v && setMethod(v)}
          options={(['cash', 'transfer', 'card', 'other'] as const).map((m) => ({ value: m, label: mt(`m_${m}`) }))} />
        {method !== 'cash' ? <Field label={mt('reference')} value={reference} onChangeText={setReference} /> : null}
        {err ? <Notice tone="danger">{err}</Notice> : null}
      </View>
    </Dialog>
  );
}

function ChargeRow({ c }: { c: Charge }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body" numberOfLines={1}>{c.description}</Text>
        <Text variant="caption" color={palette.ink2}>{mt('due', { date: dayShort(c.due_date) })}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text variant="bodyStrong">{money(c.total, c.currency)}</Text>
        <Badge label={mt(`ch_${c.status}`)} tone={CH_TONE[c.status] ?? 'neutral'} />
      </View>
    </View>
  );
}

export function BillingTab({ userId, name, onChanged }: { userId: number; name: string; onChanged: () => void }) {
  const router = useRouter();
  const wide = useIsWide();
  const ms = useApi(() => membersApi.memberships(userId), [userId]);
  const charges = useApi(() => membersApi.charges(userId), [userId]);
  const payments = useApi(() => membersApi.payments(userId), [userId]);
  const [pay, setPay] = useState(false);
  const [ok, setOk] = useState<string | null>(null);

  if (ms.loading || charges.loading || payments.loading) return <Loading />;
  const err = ms.error || charges.error || payments.error;
  if (err) return <Notice tone="danger">{err}</Notice>;

  const current = (ms.data ?? []).filter((m) => ['active', 'past_due', 'paused', 'pending'].includes(m.status));
  const open = (charges.data ?? []).filter((c) => ['pending', 'partial'].includes(c.status));
  const balance = open.reduce((s, c) => s + Number(c.balance), 0);

  return (
    <View style={{ gap: space.lg }}>
      {ok ? <Notice tone="success">{ok}</Notice> : null}
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.lg }}>
        <Card style={{ flex: wide ? 1.4 : undefined }}>
          <SectionHeader title={mt('membership')} />
          {current.length === 0 ? (
            <>
              <Text color={palette.ink2}>{mt('noMembershipBody')}</Text>
              <Button label={mt('assignMembership')} size="sm" variant="secondary" icon="plus" style={{ alignSelf: 'flex-start' }}
                onPress={() => router.push(`/memberships/new?user_id=${userId}` as never)} />
            </>
          ) : current.map((m, i) => (
            <View key={m.id} style={{ gap: 4 }}>
              {i > 0 ? <Divider /> : null}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm, alignItems: 'center' }}>
                <Text variant="heading" style={{ flexShrink: 1 }}>{m.plan_name}</Text>
                <Badge label={t(`home.status_${m.status}`)} tone={m.status === 'active' ? 'success' : m.status === 'past_due' ? 'danger' : 'warning'} />
              </View>
              <Text variant="small" color={palette.ink2}>
                {[money(m.final_price, m.currency), m.discount_reason, m.current_period_end ? mt('validUntil', { date: dayShort(m.current_period_end) }) : null].filter(Boolean).join(' · ')}
              </Text>
              {m.next_billing_date ? <Text variant="small" color={palette.ink2}>{mt('nextCharge', { date: dayShort(m.next_billing_date) })}</Text> : null}
              {m.payer_user_id !== userId ? <Text variant="small" color={palette.ink2}>{mt('paidBy', { name: m.payer_name })}</Text> : null}
              {m.members.length > 1 ? <Text variant="caption" color={palette.ink2}>{m.members.map((x) => x.first_name).join(', ')}</Text> : null}
            </View>
          ))}
        </Card>
        <Card style={{ flex: wide ? 1 : undefined }}>
          <Text variant="small" color={palette.ink2}>{mt('balance')}</Text>
          <Text variant="number" color={balance > 0 ? palette.danger : palette.ink}>{money(balance)}</Text>
          <Text variant="small" color={balance > 0 ? palette.danger : palette.success}>{balance > 0 ? `${open.length} · ${mt('charges').toLowerCase()}` : mt('upToDate')}</Text>
          <Button label={mt('registerPayment')} icon="dollar-sign" onPress={() => setPay(true)} style={{ alignSelf: 'flex-start' }} />
        </Card>
      </View>

      <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.lg, alignItems: 'flex-start' }}>
        <Card style={{ flex: 1, alignSelf: 'stretch' }}>
          <SectionHeader title={mt('charges')} />
          {(charges.data ?? []).length === 0 ? <EmptyState icon="file-text" title={mt('noCharges')} /> : (charges.data ?? []).slice(0, 20).map((c, i) => (
            <View key={c.id}>{i > 0 ? <Divider /> : null}<ChargeRow c={c} /></View>
          ))}
        </Card>
        <Card style={{ flex: 1, alignSelf: 'stretch' }}>
          <SectionHeader title={mt('payments')} />
          {(payments.data ?? []).length === 0 ? <EmptyState icon="credit-card" title={mt('noPayments')} /> : (payments.data ?? []).slice(0, 20).map((p, i) => (
            <View key={p.id}>
              {i > 0 ? <Divider /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="body">{dayShortTs(p.paid_at)} · {mt(`m_${p.method}`)}</Text>
                  {p.reference || p.received_by_name ? <Text variant="caption" color={palette.ink2} numberOfLines={1}>{[p.reference, p.received_by_name].filter(Boolean).join(' · ')}</Text> : null}
                </View>
                <Text variant="bodyStrong" color={p.status === 'completed' ? palette.ink : palette.ink3}>{money(p.amount, p.currency)}</Text>
              </View>
            </View>
          ))}
        </Card>
      </View>

      <PaymentDialog visible={pay} userId={userId} name={name} suggested={balance > 0 ? balance : undefined} onClose={() => setPay(false)}
        onSaved={() => { setPay(false); setOk(mt('paymentSaved')); charges.reload(); payments.reload(); ms.reload(); onChanged(); }} />
    </View>
  );
}
