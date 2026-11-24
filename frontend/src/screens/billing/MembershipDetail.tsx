/** Detalle de una membresía (personal): precio, integrantes, pausas, cancelación y cargos */
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { billingApi, type MembershipDetail as MS } from '../../api/billing';
import { todayYmd } from '../../api/classes';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Screen } from '../../ui/Screen';
import { Avatar, Button, Card, Divider, Field, Icon, Loading, Notice, SectionHeader, Text } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { DateField, FormGrid, Select } from '../../ui/forms';
import { palette, radius, space, fonts } from '../../theme/tokens';
import { useIsWide } from '../../navigation/AppShell';
import { t, useLanguage } from '../../i18n';
import { dayShort, fullName, money } from '../../utils/format';
import { PaymentDialog } from '../members/BillingTab';
import { PersonPicker, type PickedPerson } from '../members/PersonPicker';
import { ChargeStatus, MsStatus, bt, dueLabel, planCycle } from './bits';
import { discountLabel } from './CatalogTabs';

type Msg = { tone: 'success' | 'danger' | 'info'; text: string } | null;
type DialogKind = null | 'price' | 'members' | 'pause' | 'cancel' | 'pay';
const CUSTOM = -1;

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={{ gap: 2, flexGrow: 1, flexBasis: 160, minWidth: 0 }}>
      <Text variant="caption" color={palette.ink2}>{label}</Text>
      {typeof value === 'string' ? <Text variant="bodyStrong">{value}</Text> : value}
    </View>
  );
}

function PriceDialog({ ms, visible, onClose, onSaved }: { ms: MS; visible: boolean; onClose: () => void; onSaved: (m: MS) => void }) {
  const discounts = useApi(() => billingApi.discounts(), []);
  const [price, setPrice] = useState(String(ms.price));
  const [discountId, setDiscountId] = useState<number | null>(ms.discount_id ?? (ms.discount_type && ms.discount_type !== 'none' ? CUSTOM : null));
  const [type, setType] = useState<'percent' | 'fixed'>(ms.discount_type === 'fixed' ? 'fixed' : 'percent');
  const [value, setValue] = useState(ms.discount_value != null ? String(ms.discount_value) : '');
  const [reason, setReason] = useState(ms.discount_reason ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setBusy(true); setErr(null);
    try {
      const body: Record<string, unknown> = { price: Number(price.replace(',', '.')) };
      if (discountId === CUSTOM) Object.assign(body, { discount_id: null, discount_type: type, discount_value: Number(value.replace(',', '.')) || 0, discount_reason: reason.trim() || null });
      else if (discountId) body.discount_id = discountId;
      else Object.assign(body, { discount_id: null, discount_type: 'none', discount_value: null, discount_reason: null });
      onSaved(await billingApi.updateMembership(ms.id, body));
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog visible={visible} onClose={onClose} title={bt('editPrice')}
      actions={<><Button label={t('common.cancel')} variant="ghost" onPress={onClose} /><Button label={t('common.save')} loading={busy} onPress={save} /></>}>
      <View style={{ gap: space.md }}>
        <Notice tone="info">{bt('planChangeHint')}</Notice>
        <Field label={bt('price')} value={price} onChangeText={(v) => setPrice(v.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" />
        <Select label={bt('discount')} value={discountId} onChange={setDiscountId} allowClear placeholder={bt('noDiscount')}
          options={[...(discounts.data ?? []).filter((d) => d.active).map((d) => ({ value: d.id, label: `${d.name} · ${discountLabel(d)}` })), { value: CUSTOM, label: bt('customDiscount') }]} />
        {discountId === CUSTOM ? (
          <FormGrid>
            <Select label={bt('df_type')} value={type} onChange={(v) => v && setType(v)} options={[{ value: 'percent', label: bt('df_percent') }, { value: 'fixed', label: bt('df_fixed') }]} />
            <Field label={bt('df_value')} value={value} onChangeText={(v) => setValue(v.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" />
            <Field label={bt('discountReason')} value={reason} onChangeText={setReason} />
          </FormGrid>
        ) : null}
        {err ? <Notice tone="danger">{err}</Notice> : null}
      </View>
    </Dialog>
  );
}

function MembersDialog({ ms, visible, onClose, onSaved }: { ms: MS; visible: boolean; onClose: () => void; onSaved: (m: MS) => void }) {
  const [list, setList] = useState<PickedPerson[]>(ms.members.map((m) => ({ id: m.user_id, name: fullName(m), photo_url: m.photo_url })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setBusy(true); setErr(null);
    try { onSaved(await billingApi.setMembers(ms.id, list.map((p) => p.id))); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog visible={visible} onClose={onClose} title={bt('editMembers')}
      actions={<><Button label={t('common.cancel')} variant="ghost" onPress={onClose} /><Button label={t('common.save')} loading={busy} disabled={!list.length} onPress={save} /></>}>
      <View style={{ gap: space.sm }}>
        <Text variant="small" color={palette.ink2}>{bt('membersHint', { count: ms.max_members })}</Text>
        {list.map((p) => (
          <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Avatar name={p.name} photoUrl={p.photo_url} size={32} />
            <Text style={{ flex: 1 }}>{p.name}</Text>
            <Button label={t('members.remove')} size="sm" variant="ghost" onPress={() => setList(list.filter((x) => x.id !== p.id))} />
          </View>
        ))}
        {list.length < ms.max_members ? <PersonPicker label={bt('addMember')} value={null} exclude={list.map((p) => p.id)} onChange={(p) => p && setList([...list, p])} /> : null}
        {err ? <Notice tone="danger">{err}</Notice> : null}
      </View>
    </Dialog>
  );
}

function PauseDialog({ ms, visible, onClose, onSaved }: { ms: MS; visible: boolean; onClose: () => void; onSaved: (m: MS) => void }) {
  const [from, setFrom] = useState<string | null>(todayYmd());
  const [to, setTo] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    if (!from || !to) { setErr(bt('required')); return; }
    setBusy(true); setErr(null);
    try { onSaved(await billingApi.pause(ms.id, { start_date: from, end_date: to, reason: reason.trim() || undefined })); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog visible={visible} onClose={onClose} title={bt('pauseTitle')}
      actions={<><Button label={t('common.cancel')} variant="ghost" onPress={onClose} /><Button label={bt('pause')} loading={busy} onPress={save} /></>}>
      <View style={{ gap: space.md }}>
        <Text variant="small" color={palette.ink2}>{bt('pauseHint')}</Text>
        <FormGrid>
          <DateField label={bt('pauseFrom')} value={from} onChange={setFrom} />
          <DateField label={bt('pauseTo')} value={to} onChange={setTo} />
        </FormGrid>
        <Field label={bt('pauseReason')} value={reason} onChangeText={setReason} />
        {err ? <Notice tone="danger">{err}</Notice> : null}
      </View>
    </Dialog>
  );
}

function CancelDialog({ ms, visible, onClose, onSaved }: { ms: MS; visible: boolean; onClose: () => void; onSaved: (m: MS, immediate: boolean) => void }) {
  const [immediate, setImmediate] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setBusy(true); setErr(null);
    try { onSaved(await billingApi.cancel(ms.id, { immediate, reason: reason.trim() || undefined }), immediate); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  const Option = ({ on, title, hint, onPress }: { on: boolean; title: string; hint: string; onPress: () => void }) => (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={onPress}
      style={{ flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: on ? palette.ink : palette.line }}>
      <Icon name={on ? 'check-circle' : 'circle'} size={18} color={on ? palette.ink : palette.ink3} />
      <View style={{ flex: 1 }}><Text variant="bodyStrong">{title}</Text><Text variant="small" color={palette.ink2}>{hint}</Text></View>
    </Pressable>
  );
  return (
    <Dialog visible={visible} onClose={onClose} title={bt('cancelTitle')}
      actions={<><Button label={bt('keep')} variant="ghost" onPress={onClose} /><Button label={bt('cancelMs')} variant="danger" loading={busy} onPress={save} /></>}>
      <View style={{ gap: space.sm }}>
        {ms.current_period_end ? <Option on={!immediate} onPress={() => setImmediate(false)} title={bt('cancelAtEnd')} hint={bt('cancelAtEndHint', { date: dayShort(ms.current_period_end) })} /> : null}
        <Option on={immediate || !ms.current_period_end} onPress={() => setImmediate(true)} title={bt('cancelNow')} hint={bt('cancelNowHint')} />
        <Field label={bt('cancelReason')} value={reason} onChangeText={setReason} />
        {err ? <Notice tone="danger">{err}</Notice> : null}
      </View>
    </Dialog>
  );
}

export function MembershipDetail() {
  useLanguage();
  const router = useRouter();
  const wide = useIsWide();
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const data = useApi(() => billingApi.membership(Number(id)), [id]);
  const [dlg, setDlg] = useState<DialogKind>(null);
  const [msg, setMsg] = useState<Msg>(created ? { tone: 'success', text: bt('created') } : null);
  const [busy, setBusy] = useState(false);
  const today = todayYmd();

  if (data.loading) return <Loading />;
  if (data.error || !data.data) return <Screen><Notice tone="danger">{data.error ?? ''}</Notice></Screen>;
  const ms = data.data;
  const live = !['cancelled', 'expired'].includes(ms.status);
  const done = (m: MS, text: string) => { data.setData(m); setDlg(null); setMsg({ tone: 'success', text }); };

  async function resume() {
    setBusy(true);
    try { done(await billingApi.resume(ms.id), bt('resumed')); } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(false); }
  }

  return (
    <Screen maxWidth={1100}>
      <Pressable accessibilityRole="link" onPress={() => (router.canGoBack() ? router.back() : router.replace('/memberships' as never))}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}>
        <Icon name="chevron-left" size={18} color={palette.ink2} /><Text variant="smallStrong" color={palette.ink2}>{bt('back')}</Text>
      </Pressable>

      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
          <Text variant="title" accessibilityRole="header">{ms.plan_name}</Text>
          <MsStatus status={ms.status} />
        </View>
        <Text style={{ fontFamily: fonts.display, fontSize: 28 }}>{money(ms.final_price, ms.currency)} <Text variant="small" color={palette.ink2}>· {planCycle(ms)}</Text></Text>
        {ms.final_price !== Number(ms.price) ? <Text variant="small" color={palette.ink2}>{money(ms.price, ms.currency)} − {ms.discount_reason ?? bt('discount')}</Text> : null}
      </View>

      {live ? (
        <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
          <Button label={t('members.registerPayment')} icon="dollar-sign" onPress={() => setDlg('pay')} />
          <Button label={bt('editPrice')} variant="secondary" size="sm" icon="tag" onPress={() => setDlg('price')} />
          {ms.max_members > 1 ? <Button label={bt('editMembers')} variant="secondary" size="sm" icon="users" onPress={() => setDlg('members')} /> : null}
          <Button label={bt('pause')} variant="secondary" size="sm" icon="pause-circle" onPress={() => setDlg('pause')} />
          {ms.cancel_at_period_end ? <Button label={bt('resume')} variant="secondary" size="sm" icon="rotate-ccw" loading={busy} onPress={resume} />
            : <Button label={bt('cancelMs')} variant="danger" size="sm" icon="x-circle" onPress={() => setDlg('cancel')} />}
        </View>
      ) : null}

      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {ms.cancel_at_period_end && ms.current_period_end ? <Notice tone="warning">{bt('cancelScheduled', { date: dayShort(ms.current_period_end) })}</Notice> : null}
      {ms.status === 'cancelled' ? <Notice tone="info">{bt('cancelledOn', { reason: ms.cancel_reason ?? '' })}</Notice> : null}

      <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.lg, alignItems: 'flex-start' }}>
        <View style={{ flex: wide ? 1.3 : undefined, alignSelf: 'stretch', gap: space.lg }}>
          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
              <Info label={bt('currentPeriod')} value={ms.current_period_start && ms.current_period_end ? `${dayShort(ms.current_period_start)} – ${dayShort(ms.current_period_end)}` : dayShort(ms.start_date)} />
              <Info label={bt('nextBilling')} value={ms.next_billing_date && ms.auto_renew ? dayShort(ms.next_billing_date) : bt('noAutoRenew')} />
              <Info label={t('members.balance')} value={<Text variant="bodyStrong" color={ms.balance_due > 0 ? palette.danger : palette.success}>{ms.balance_due > 0 ? money(ms.balance_due, ms.currency) : t('members.upToDate')}</Text>} />
              {ms.sessions_remaining != null ? <Info label={bt('bt_class_pack')} value={bt('sessionsLeft', { count: ms.sessions_remaining })} /> : null}
            </View>
            <Divider />
            <Text variant="caption" color={palette.ink2}>{bt('members')}</Text>
            {ms.members.map((m) => (
              <Pressable key={m.user_id} accessibilityRole="link" onPress={() => router.push(`/members/${m.user_id}` as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Avatar name={fullName(m)} photoUrl={m.photo_url} size={32} />
                <Text variant="bodyStrong" style={{ textDecorationLine: 'underline' }}>{fullName(m)}</Text>
              </Pressable>
            ))}
            <Text variant="small" color={palette.ink2}>{bt('paidBy')}: {ms.payer_name}</Text>
            {ms.notes ? <Text variant="small" color={palette.ink2}>{ms.notes}</Text> : null}
          </Card>
          {ms.pauses.length ? (
            <Card>
              <SectionHeader title={bt('pauses')} />
              {ms.pauses.map((p) => <Text key={p.id} variant="small">{dayShort(p.start_date)} – {dayShort(p.end_date)}{p.reason ? ` · ${p.reason}` : ''}</Text>)}
            </Card>
          ) : null}
        </View>
        <Card style={{ flex: wide ? 1 : undefined, alignSelf: 'stretch' }}>
          <SectionHeader title={bt('charges')} />
          {ms.charges.length === 0 ? <Text color={palette.ink2}>{t('members.noCharges')}</Text> : ms.charges.map((c, i) => {
            const open = c.status === 'pending' || c.status === 'partial';
            return (
              <View key={c.id}>
                {i > 0 ? <Divider /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1}>{c.description}</Text>
                    <Text variant="caption" color={open && c.due_date < today ? palette.danger : palette.ink2}>{dueLabel(c.due_date, today, open)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text variant="bodyStrong">{money(c.total, ms.currency)}</Text>
                    <ChargeStatus status={c.status} due={c.due_date} today={today} />
                  </View>
                </View>
              </View>
            );
          })}
        </Card>
      </View>

      <PriceDialog key={`p${dlg}`} ms={ms} visible={dlg === 'price'} onClose={() => setDlg(null)} onSaved={(m) => done(m, bt('saved'))} />
      <MembersDialog key={`m${dlg}`} ms={ms} visible={dlg === 'members'} onClose={() => setDlg(null)} onSaved={(m) => done(m, bt('saved'))} />
      <PauseDialog key={`z${dlg}`} ms={ms} visible={dlg === 'pause'} onClose={() => setDlg(null)} onSaved={(m) => done(m, bt('paused'))} />
      <CancelDialog key={`c${dlg}`} ms={ms} visible={dlg === 'cancel'} onClose={() => setDlg(null)} onSaved={(m, now) => done(m, now ? bt('cancelledOk') : bt('scheduledOk'))} />
      <PaymentDialog visible={dlg === 'pay'} userId={ms.payer_user_id} name={ms.payer_name} suggested={ms.balance_due > 0 ? ms.balance_due : undefined}
        onClose={() => setDlg(null)} onSaved={() => { setDlg(null); setMsg({ tone: 'success', text: t('members.paymentSaved') }); data.reload(); }} />
    </Screen>
  );
}
