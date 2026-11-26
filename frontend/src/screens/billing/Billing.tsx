/** Cobranza (personal): resumen, adeudos y pagos */
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { billingApi, type ChargeRow, type PaymentRow } from '../../api/billing';
import { todayYmd } from '../../api/classes';
import { useSession } from '../../session/SessionProvider';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Screen } from '../../ui/Screen';
import { Badge, Button, Card, Divider, EmptyState, Field, Loading, Notice, Text } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { DateField, FilterChips, FormGrid, SearchField, Select, Tabs } from '../../ui/forms';
import { palette, space } from '../../theme/tokens';
import { useIsWide } from '../../navigation/AppShell';
import { getLanguage, t, useLanguage } from '../../i18n';
import { dateTimeShort, money } from '../../utils/format';
import { PaymentDialog } from '../members/BillingTab';
import { PersonPicker, type PickedPerson } from '../members/PersonPicker';
import { ChargeStatus, Tile, bt, dueLabel, monthRange } from './bits';

type Msg = { tone: 'success' | 'danger' | 'info'; text: string } | null;

function useDebounced(v: string) {
  const [d, setD] = useState(v);
  useEffect(() => { const h = setTimeout(() => setD(v), 300); return () => clearTimeout(h); }, [v]);
  return d;
}

// ---------------------------------------------------------------------------
function ChargeDialog({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const [who, setWho] = useState<PickedPerson | null>(null);
  const [type, setType] = useState('event');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (visible) { setWho(null); setType('event'); setDescription(''); setAmount(''); setDue(null); setErr(null); } }, [visible]);
  async function save() {
    const n = Number(amount.replace(',', '.'));
    if (!who || !description.trim() || !(n > 0)) { setErr(bt('required')); return; }
    setBusy(true); setErr(null);
    try { await billingApi.createCharge({ user_id: who.id, type, description: description.trim(), amount: n, ...(due ? { due_date: due } : {}) }); onSaved(); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog visible={visible} onClose={onClose} title={bt('chargeTitle')}
      actions={<><Button label={t('common.cancel')} variant="ghost" onPress={onClose} /><Button label={t('common.save')} loading={busy} onPress={save} /></>}>
      <View style={{ gap: space.md }}>
        <PersonPicker label={`${bt('person')} *`} value={who} onChange={setWho} />
        <Select label={bt('chargeType')} value={type} onChange={(v) => v && setType(v)}
          options={['event', 'product', 'exam_fee', 'signup_fee', 'membership', 'adjustment', 'other'].map((k) => ({ value: k, label: bt(`t_${k}`) }))} />
        <Field label={`${bt('description')} *`} value={description} onChangeText={setDescription} />
        <FormGrid>
          <Field label={`${bt('amount')} *`} value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" />
          <DateField label={bt('dueDate')} value={due} onChange={setDue} />
        </FormGrid>
        {err ? <Notice tone="danger">{err}</Notice> : null}
      </View>
    </Dialog>
  );
}

function ReasonDialog({ visible, title, body, action, onClose, onConfirm }: {
  visible: boolean; title: string; body: string; action: string; onClose: () => void; onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (visible) { setReason(''); setErr(null); } }, [visible]);
  return (
    <Dialog visible={visible} onClose={onClose} title={title}
      actions={<><Button label={bt('keep')} variant="ghost" onPress={onClose} /><Button label={action} variant="danger" loading={busy} disabled={!reason.trim()}
        onPress={async () => { setBusy(true); setErr(null); try { await onConfirm(reason.trim()); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); } }} /></>}>
      <Text color={palette.ink2}>{body}</Text>
      <Field label={`${bt('voidReason')} *`} value={reason} onChangeText={setReason} />
      {err ? <Notice tone="danger">{err}</Notice> : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function ChargesTab({ onChanged, version }: { onChanged: () => void; version: number }) {
  const router = useRouter();
  const wide = useIsWide();
  const { hasRole } = useSession();
  const admin = hasRole('admin');
  const today = todayYmd();
  const [status, setStatus] = useState<'overdue' | 'open' | 'paid' | 'all'>('overdue');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const data = useApi(() => billingApi.charges({ status, q: dq || undefined, page_size: 100 }), [status, dq, version]);
  const [pay, setPay] = useState<ChargeRow | null>(null);
  const [voiding, setVoiding] = useState<ChargeRow | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const rows = data.data?.data ?? [];
  const meta = data.data?.meta as { total?: number; balance?: number } | undefined;
  const forWhom = (c: ChargeRow) => (c.member_names && c.member_names !== c.user_name.split(' ')[0] ? bt('forMembers', { names: c.member_names }) : null);

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', alignItems: 'center' }}>
        <SearchField value={q} onChange={setQ} placeholder={bt('search')} />
        <FilterChips label={bt('tab_charges')} value={status} onChange={setStatus}
          options={(['overdue', 'open', 'paid', 'all'] as const).map((k) => ({ key: k, label: bt(`c_${k}`) }))} />
      </View>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {meta && (status === 'overdue' || status === 'open') && rows.length ? (
        <Text variant="small" color={palette.ink2}>{bt('chargesCount', { count: meta.total ?? rows.length })} · {money(meta.balance)}</Text>
      ) : null}
      <Card padding={0} style={{ overflow: 'hidden' }}>
        {data.loading ? <Loading /> : rows.length === 0 ? <EmptyState icon="check-circle" title={bt('noCharges')} body={bt('noChargesBody')} /> : rows.map((c, i) => {
          const open = c.status === 'pending' || c.status === 'partial';
          return (
            <View key={c.id}>
              {i > 0 ? <Divider /> : null}
              {wide ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md }}>
                  <Pressable accessibilityRole="link" onPress={() => router.push(`/members/${c.user_id}?tab=billing` as never)} style={{ flex: 2, minWidth: 0 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>{c.user_name}</Text>
                    <Text variant="small" color={palette.ink2} numberOfLines={1}>{c.description}</Text>
                    {forWhom(c) ? <Text variant="caption" color={palette.ink2}>{forWhom(c)}</Text> : null}
                  </Pressable>
                  <View style={{ flex: 1.2, gap: 2 }}>
                    <Text variant="small" color={open && c.due_date < today ? palette.danger : palette.ink2}>{dueLabel(c.due_date, today, open)}</Text>
                    {c.status === 'partial' ? <Text variant="caption" color={palette.ink2}>{bt('paidOf', { paid: money(c.amount_paid, c.currency), total: money(c.total, c.currency) })}</Text> : null}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: 'flex-end', flex: 1.6 }}>
                    <Text variant="bodyStrong" style={{ minWidth: 84, textAlign: 'right' }}>{money(open ? c.balance : c.total, c.currency)}</Text>
                    <ChargeStatus status={c.status} due={c.due_date} today={today} />
                    {open ? <Button label={bt('collect')} size="sm" onPress={() => setPay(c)} /> : null}
                    {open && admin && Number(c.amount_paid) === 0 ? <Button label={bt('voidCharge')} size="sm" variant="ghost" onPress={() => setVoiding(c)} /> : null}
                  </View>
                </View>
              ) : (
                // Celular: nombre y monto arriba, detalle en medio, acciones abajo
                <View style={{ gap: 6, padding: space.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
                    <Pressable accessibilityRole="link" onPress={() => router.push(`/members/${c.user_id}?tab=billing` as never)} style={{ flex: 1, minWidth: 0 }}>
                      <Text variant="bodyStrong" numberOfLines={1}>{c.user_name}</Text>
                    </Pressable>
                    <Text variant="bodyStrong">{money(open ? c.balance : c.total, c.currency)}</Text>
                  </View>
                  <Text variant="small" color={palette.ink2}>{c.description}{forWhom(c) ? ` · ${forWhom(c)}` : ''}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                    <ChargeStatus status={c.status} due={c.due_date} today={today} />
                    <Text variant="small" color={open && c.due_date < today ? palette.danger : palette.ink2} style={{ flexShrink: 1 }}>{dueLabel(c.due_date, today, open)}</Text>
                  </View>
                  {c.status === 'partial' ? <Text variant="caption" color={palette.ink2}>{bt('paidOf', { paid: money(c.amount_paid, c.currency), total: money(c.total, c.currency) })}</Text> : null}
                  {open ? (
                    <View style={{ flexDirection: 'row', gap: space.xs, marginTop: 2 }}>
                      <Button label={bt('collect')} size="sm" icon="dollar-sign" onPress={() => setPay(c)} style={{ flexGrow: 1 }} />
                      {admin && Number(c.amount_paid) === 0 ? <Button label={bt('voidCharge')} size="sm" variant="secondary" onPress={() => setVoiding(c)} /> : null}
                    </View>
                  ) : null}
                </View>
              )}
            </View>
          );
        })}
      </Card>
      <PaymentDialog visible={!!pay} userId={pay?.user_id} name={pay?.user_name} suggested={pay ? Number(pay.balance) : undefined}
        onClose={() => setPay(null)} onSaved={() => { setPay(null); setMsg({ tone: 'success', text: t('members.paymentSaved') }); data.reload(); onChanged(); }} />
      <ReasonDialog visible={!!voiding} title={bt('voidTitle')} body={voiding ? `${voiding.user_name} · ${voiding.description} · ${money(voiding.total)}\n${bt('voidBody')}` : ''} action={bt('voidCharge')}
        onClose={() => setVoiding(null)}
        onConfirm={async (r) => { await billingApi.voidCharge(voiding!.id, r); setVoiding(null); setMsg({ tone: 'success', text: bt('voided') }); data.reload(); onChanged(); }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
/** 'AAAA-MM' → { from, to } */
function monthOf(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: f(new Date(y, m - 1, 1)), to: f(new Date(y, m, 0)) };
}
const monthName = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const s = new Intl.DateTimeFormat(getLanguage() === 'en' ? 'en-US' : 'es-MX', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
  return s[0].toUpperCase() + s.slice(1);
};

function PaymentsTab({ onChanged, version, initialMonth }: { onChanged: () => void; version: number; initialMonth?: string }) {
  const router = useRouter();
  const wide = useIsWide();
  const { hasRole } = useSession();
  const admin = hasRole('admin');
  const thisYm = monthRange(0).from.slice(0, 7); const lastYm = monthRange(-1).from.slice(0, 7);
  const custom = initialMonth && /^\d{4}-\d{2}$/.test(initialMonth) && initialMonth !== thisYm && initialMonth !== lastYm ? initialMonth : null;
  const [range, setRange] = useState<'thisMonth' | 'lastMonth' | 'all' | 'month'>(
    custom ? 'month' : initialMonth === lastYm ? 'lastMonth' : 'thisMonth');
  const [method, setMethod] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const r = range === 'all' ? {} : range === 'month' && custom ? monthOf(custom) : monthRange(range === 'thisMonth' ? 0 : -1);
  const data = useApi(() => billingApi.payments({ status: 'all', ...r, method: method ?? undefined, q: dq || undefined, page_size: 100 }), [range, method, dq, version]);
  const [cancelling, setCancelling] = useState<PaymentRow | null>(null);
  const [refunding, setRefunding] = useState<PaymentRow | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const rows = data.data?.data ?? [];
  const meta = data.data?.meta as { sum?: number } | undefined;

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <SearchField value={q} onChange={setQ} placeholder={bt('search')} />
        <View style={{ width: wide ? 220 : '100%' }}>
          <Select label={t('members.method')} value={method} onChange={setMethod} allowClear placeholder={bt('allMethods')}
            options={['cash', 'transfer', 'card', 'mercadopago', 'paypal', 'other'].map((m) => ({ value: m, label: t(`members.m_${m}`) }))} />
        </View>
      </View>
      <FilterChips label={bt('tab_payments')} value={range} onChange={setRange}
        options={[
          ...(custom ? [{ key: 'month' as const, label: monthName(custom) }] : []),
          ...(['thisMonth', 'lastMonth', 'all'] as const).map((k) => ({ key: k, label: bt(`p_${k}`) })),
        ]} />
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {meta?.sum != null && rows.length ? <Text variant="small" color={palette.ink2}>{t('members.payments')}: {rows.length} · {money(meta.sum)}</Text> : null}
      <Card padding={0} style={{ overflow: 'hidden' }}>
        {data.loading ? <Loading /> : rows.length === 0 ? <EmptyState icon="credit-card" title={bt('noPayments')} /> : rows.map((p, i) => {
          const cancelled = p.status === 'cancelled' || p.status === 'refunded';
          return (
            <View key={p.id}>
              {i > 0 ? <Divider /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, opacity: cancelled ? 0.55 : 1 }}>
                <Pressable accessibilityRole="link" onPress={() => router.push(`/members/${p.user_id}?tab=billing` as never)} style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>{p.user_name}</Text>
                  <Text variant="caption" color={palette.ink2} numberOfLines={2}>
                    {[dateTimeShort(p.paid_at), t(`members.m_${p.method}`), p.reference, p.received_by_name ? bt('receivedBy', { name: p.received_by_name }) : null,
                      Number(p.provider_fee) > 0 ? bt('providerFee', { name: t(`members.m_${p.method}`), amount: money(Number(p.provider_fee), p.currency) }) : null].filter(Boolean).join(' · ')}
                  </Text>
                </Pressable>
                <View style={{ alignItems: 'flex-end', gap: 4, flexDirection: wide ? 'row' : 'column', ...(wide ? { alignItems: 'center', gap: space.sm } : {}) }}>
                  {cancelled ? <Badge label={bt(p.status === 'refunded' ? 'refundedPayment' : 'cancelledPayment')} /> : null}
                  <Text variant="bodyStrong" style={{ textDecorationLine: cancelled ? 'line-through' : 'none' }}>{money(p.amount, p.currency)}</Text>
                  {admin && p.status === 'completed' && !p.provider
                    ? (wide ? <Button label={bt('cancelPayment')} size="sm" variant="ghost" onPress={() => setCancelling(p)} />
                      : <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setCancelling(p)}><Text variant="caption" color={palette.danger} style={{ textDecorationLine: 'underline' }}>{bt('cancelPayment')}</Text></Pressable>)
                    : null}
                  {admin && p.status === 'completed' && p.provider
                    ? (wide ? <Button label={bt('refundPayment')} size="sm" variant="ghost" onPress={() => setRefunding(p)} />
                      : <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setRefunding(p)}><Text variant="caption" color={palette.danger} style={{ textDecorationLine: 'underline' }}>{bt('refundPayment')}</Text></Pressable>)
                    : null}
                </View>
              </View>
            </View>
          );
        })}
      </Card>
      <ReasonDialog visible={!!cancelling} title={cancelling ? bt('cancelPaymentTitle', { amount: money(cancelling.amount) }) : ''}
        body={cancelling ? `${cancelling.user_name} · ${dateTimeShort(cancelling.paid_at)}\n${bt('cancelPaymentBody')}` : ''} action={bt('cancelPayment')}
        onClose={() => setCancelling(null)}
        onConfirm={async (reason) => { await billingApi.cancelPayment(cancelling!.id, reason); setCancelling(null); setMsg({ tone: 'success', text: bt('paymentCancelled') }); data.reload(); onChanged(); }} />
      <ReasonDialog visible={!!refunding} title={refunding ? bt('refundTitle', { amount: money(refunding.amount) }) : ''}
        body={refunding ? `${refunding.user_name} · ${dateTimeShort(refunding.paid_at)}\n${bt('refundBody', { provider: t(`members.m_${refunding.method}`) })}` : ''} action={bt('refundPayment')}
        onClose={() => setRefunding(null)}
        onConfirm={async (reason) => { await billingApi.refundPayment(refunding!.id, reason); setRefunding(null); setMsg({ tone: 'success', text: bt('paymentRefunded') }); data.reload(); onChanged(); }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
export function Billing() {
  useLanguage();
  const wide = useIsWide();
  const params = useLocalSearchParams<{ new?: string; tab?: string; month?: string }>();
  const { hasRole } = useSession();
  const admin = hasRole('admin');
  const [tab, setTab] = useState<'charges' | 'payments'>(params.tab === 'payments' ? 'payments' : 'charges');
  const [version, setVersion] = useState(0);
  const [payOpen, setPayOpen] = useState(params.new === 'payment');
  const [chargeOpen, setChargeOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const month = monthRange(0);
  const kpi = useApi(async () => {
    const [open, overdue, paid] = await Promise.all([
      billingApi.charges({ status: 'open', page_size: 1 }), billingApi.charges({ status: 'overdue', page_size: 1 }),
      billingApi.payments({ status: 'completed', from: month.from, to: month.to, page_size: 1 }),
    ]);
    const m = (r: { meta?: unknown }, k: string) => Number((r.meta as Record<string, number> | undefined)?.[k] ?? 0);
    return { open: m(open, 'balance'), overdue: m(overdue, 'balance'), overdueCount: m(overdue, 'total'), collected: m(paid, 'sum') };
  }, [version]);
  const changed = () => setVersion((v) => v + 1);

  async function run() {
    setRunning(true); setMsg(null);
    try {
      const r = await billingApi.runBilling();
      setMsg({ tone: 'success', text: bt('runBillingDone', { renewed: r.renewed ?? 0, past_due: r.past_due ?? 0, expired: r.expired ?? 0 }) });
      changed();
    } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setRunning(false); }
  }

  return (
    <Screen maxWidth={1200} onRefresh={changed}>
      {wide ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: space.md }}>
          <Text variant="title" accessibilityRole="header">{bt('billing')}</Text>
          <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap', flexShrink: 1, justifyContent: 'flex-end' }}>
            {admin ? <Button label={bt('runBilling')} variant="ghost" icon="refresh-cw" loading={running} onPress={run} /> : null}
            <Button label={bt('newCharge')} variant="secondary" icon="file-plus" onPress={() => setChargeOpen(true)} />
            <Button label={bt('registerPayment')} icon="dollar-sign" onPress={() => setPayOpen(true)} />
          </View>
        </View>
      ) : (
        // Celular: la acción principal a todo lo ancho y las secundarias debajo
        <View style={{ gap: space.sm }}>
          <Text variant="title" accessibilityRole="header">{bt('billing')}</Text>
          <Button label={bt('registerPayment')} icon="dollar-sign" onPress={() => setPayOpen(true)} />
          <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
            <Button label={bt('newCharge')} variant="secondary" size="sm" icon="file-plus" onPress={() => setChargeOpen(true)} style={{ flexGrow: 1 }} />
            {admin ? <Button label={bt('runBilling')} variant="secondary" size="sm" icon="refresh-cw" loading={running} onPress={run} style={{ flexGrow: 1 }} /> : null}
          </View>
        </View>
      )}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
        {kpi.loading ? <Loading /> : (
          <>
            <Tile label={bt('toCollect')} value={money(kpi.data?.open)} />
            <Tile label={bt('overdue')} value={money(kpi.data?.overdue)} tone={(kpi.data?.overdue ?? 0) > 0 ? palette.danger : undefined}
              hint={kpi.data?.overdueCount ? bt('chargesCount', { count: kpi.data.overdueCount }) : undefined} />
            <Tile label={bt('collectedMonth')} value={money(kpi.data?.collected)} tone={palette.success} />
          </>
        )}
      </Card>

      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'charges', label: bt('tab_charges') }, { key: 'payments', label: bt('tab_payments') }]} />
      {tab === 'charges' ? <ChargesTab onChanged={changed} version={version} /> : <PaymentsTab onChanged={changed} version={version} initialMonth={params.month} />}

      <PaymentDialog visible={payOpen} onClose={() => setPayOpen(false)}
        onSaved={() => { setPayOpen(false); setMsg({ tone: 'success', text: t('members.paymentSaved') }); changed(); }} />
      <ChargeDialog visible={chargeOpen} onClose={() => setChargeOpen(false)} onSaved={() => { setChargeOpen(false); setMsg({ tone: 'success', text: bt('chargeCreated') }); changed(); }} />
    </Screen>
  );
}
