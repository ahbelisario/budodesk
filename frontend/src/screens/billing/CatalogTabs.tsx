/** Pestañas Planes y Descuentos (catálogo del dojo) */
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { billingApi, type BillingType, type Discount, type IntervalUnit, type Plan, type PlanInput } from '../../api/billing';
import { membersApi } from '../../api/members';
import { ApiError } from '../../api/client';
import { useSession } from '../../session/SessionProvider';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Badge, Button, Card, EmptyState, Field, Icon, Loading, Notice, Text } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { FormGrid, Select, SwitchRow } from '../../ui/forms';
import { palette, radius, space } from '../../theme/tokens';
import { useIsWide } from '../../navigation/AppShell';
import { t } from '../../i18n';
import { money } from '../../utils/format';
import { PlanLine, bt } from './bits';

type Msg = { tone: 'success' | 'danger'; text: string } | null;
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
const str = (n: number | null | undefined) => (n == null ? '' : String(n));
const digits = (v: string) => v.replace(/[^\d.,]/g, '');

// ---------------------------------------------------------------------------
function PlanDialog({ visible, plan, onClose, onSaved }: { visible: boolean; plan: Plan | null; onClose: () => void; onSaved: () => void }) {
  const structure = useApi(() => membersApi.structure(), []);
  const disciplines = structure.data ?? [];
  const blank = {
    name: '', description: '', billing_type: 'recurring' as BillingType, interval_unit: 'month' as IntervalUnit, interval_count: '1',
    price: '', signup_fee: '', sessions_per_week: '', total_sessions: '', validity_days: '', max_members: '1',
    all_disciplines: true, discipline_ids: [] as number[], visible_to_students: true, active: true,
  };
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setErrors({}); setErr(null);
    setF(plan ? {
      name: plan.name, description: plan.description ?? '', billing_type: plan.billing_type, interval_unit: plan.interval_unit ?? 'month',
      interval_count: str(plan.interval_count ?? 1), price: str(plan.price), signup_fee: str(plan.signup_fee), sessions_per_week: str(plan.sessions_per_week),
      total_sessions: str(plan.total_sessions), validity_days: str(plan.validity_days), max_members: str(plan.max_members),
      all_disciplines: !!plan.all_disciplines, discipline_ids: plan.discipline_ids, visible_to_students: !!plan.visible_to_students, active: !!plan.active,
    } : blank);
  }, [visible, plan]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = bt('required');
    if (num(f.price) == null) e.price = bt('required');
    if (f.billing_type === 'class_pack' && !num(f.total_sessions)) e.total_sessions = bt('required');
    if (!f.all_disciplines && f.discipline_ids.length === 0) e.disciplines = bt('required');
    setErrors(e);
    if (Object.keys(e).length) return;
    const rec = f.billing_type === 'recurring';
    const body: PlanInput = {
      name: f.name.trim(), description: f.description.trim() || null, billing_type: f.billing_type,
      interval_unit: rec ? f.interval_unit : null, interval_count: rec ? (num(f.interval_count) ?? 1) : null,
      price: num(f.price) ?? 0, signup_fee: num(f.signup_fee), sessions_per_week: num(f.sessions_per_week),
      total_sessions: f.billing_type === 'class_pack' ? num(f.total_sessions) : null,
      validity_days: rec ? null : num(f.validity_days), max_members: num(f.max_members) ?? 1,
      all_disciplines: f.all_disciplines, discipline_ids: f.all_disciplines ? [] : f.discipline_ids, visible_to_students: f.visible_to_students,
    };
    setSaving(true); setErr(null);
    try {
      if (plan) await billingApi.updatePlan(plan.id, { ...body, active: f.active });
      else await billingApi.createPlan(body);
      onSaved();
    } catch (x) {
      if (x instanceof ApiError) setErrors(Object.fromEntries((x.details ?? []).map((d) => [d.field, d.message])));
      setErr(errorMessage(x));
    } finally { setSaving(false); }
  }

  const rec = f.billing_type === 'recurring';
  return (
    <Dialog visible={visible} onClose={onClose} title={plan ? bt('editPlan') : bt('newPlan')} wide
      actions={<><Button label={t('common.cancel')} variant="ghost" onPress={onClose} /><Button label={t('common.save')} icon="check" loading={saving} onPress={save} /></>}>
      <View style={{ gap: space.md }}>
        {plan ? <Notice tone="info">{bt('planChangeHint')}</Notice> : null}
        <Field label={`${bt('pf_name')} *`} value={f.name} onChangeText={set('name')} error={errors.name} />
        <FormGrid>
          <Select label={bt('pf_type')} value={f.billing_type} onChange={(v) => v && set('billing_type')(v)}
            options={(['recurring', 'class_pack', 'one_time', 'trial'] as const).map((b) => ({ value: b, label: bt(`bt_${b}`) }))} />
          <Field label={`${bt('pf_price')} *`} value={f.price} onChangeText={(v) => set('price')(digits(v))} keyboardType="decimal-pad" error={errors.price} />
          {rec ? <Field label={bt('pf_every')} value={f.interval_count} onChangeText={(v) => set('interval_count')(v.replace(/\D/g, ''))} keyboardType="number-pad" /> : null}
          {rec ? <Select label={bt('pf_unit')} value={f.interval_unit} onChange={(v) => v && set('interval_unit')(v)}
            options={(['week', 'month', 'year'] as const).map((u) => ({ value: u, label: bt(`u_${u}`) }))} /> : null}
          {f.billing_type === 'class_pack' ? <Field label={`${bt('pf_total')} *`} value={f.total_sessions} onChangeText={(v) => set('total_sessions')(v.replace(/\D/g, ''))} keyboardType="number-pad" error={errors.total_sessions} /> : null}
          {!rec ? <Field label={bt('pf_validity')} value={f.validity_days} onChangeText={(v) => set('validity_days')(v.replace(/\D/g, ''))} keyboardType="number-pad" hint={bt('pf_validityHint')} /> : null}
          <Field label={bt('pf_signup')} value={f.signup_fee} onChangeText={(v) => set('signup_fee')(digits(v))} keyboardType="decimal-pad" hint={bt('pf_signupHint')} />
          <Field label={bt('pf_perWeek')} value={f.sessions_per_week} onChangeText={(v) => set('sessions_per_week')(v.replace(/\D/g, ''))} keyboardType="number-pad" hint={bt('pf_perWeekHint')} />
          <Field label={bt('pf_maxMembers')} value={f.max_members} onChangeText={(v) => set('max_members')(v.replace(/\D/g, ''))} keyboardType="number-pad" hint={bt('pf_maxMembersHint')} />
        </FormGrid>
        <Field label={bt('pf_description')} value={f.description} onChangeText={set('description')} multiline style={{ minHeight: 64, paddingVertical: 12, textAlignVertical: 'top' }} />
        <SwitchRow label={bt('pf_allDisciplines')} value={f.all_disciplines} onChange={set('all_disciplines')} />
        {!f.all_disciplines ? (
          <View style={{ gap: 6 }}>
            <Text variant="smallStrong">{bt('pf_disciplines')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
              {disciplines.map((d) => {
                const on = f.discipline_ids.includes(d.id);
                return (
                  <Pressable key={d.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                    onPress={() => set('discipline_ids')(on ? f.discipline_ids.filter((x) => x !== d.id) : [...f.discipline_ids, d.id])}
                    style={{ height: 36, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
                      borderColor: on ? palette.ink : palette.line, backgroundColor: on ? palette.ink : palette.surface }}>
                    {on ? <Icon name="check" size={14} color="#FFFFFF" /> : null}
                    <Text variant="smallStrong" color={on ? '#FFFFFF' : palette.ink}>{d.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            {errors.disciplines ? <Text variant="small" color={palette.danger}>{errors.disciplines}</Text> : null}
          </View>
        ) : null}
        <SwitchRow label={bt('pf_visible')} hint={bt('pf_visibleHint')} value={f.visible_to_students} onChange={set('visible_to_students')} />
        {plan ? <SwitchRow label={bt('pf_active')} hint={bt('pf_activeHint')} value={f.active} onChange={set('active')} /> : null}
        {err ? <Notice tone="danger">{err}</Notice> : null}
      </View>
    </Dialog>
  );
}

export function PlansTab() {
  const { hasRole } = useSession();
  const admin = hasRole('admin');
  const wide = useIsWide();
  const [showInactive, setShowInactive] = useState(false);
  const data = useApi(() => billingApi.plans(showInactive), [showInactive]);
  const structure = useApi(() => membersApi.structure(), []);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const discName = (id: number) => structure.data?.find((d) => d.id === id)?.name ?? '';

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 220, maxWidth: 320 }}><SwitchRow label={bt('showInactive')} value={showInactive} onChange={setShowInactive} /></View>
        {admin ? <Button label={bt('newPlan')} icon="plus" onPress={() => { setEditing(null); setOpen(true); }} /> : null}
      </View>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {data.loading ? <Loading /> : (data.data ?? []).length === 0 ? (
        <Card><EmptyState icon="tag" title={bt('noPlans')} body={bt('noPlansBody')} /></Card>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
          {(data.data ?? []).map((p) => (
            <View key={p.id} style={{ flexGrow: 1, flexBasis: wide ? 300 : '100%', maxWidth: wide ? 480 : undefined, minWidth: 0 }}>
              <Card style={{ gap: space.sm, opacity: p.active ? 1 : 0.6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.sm }}>
                  <Text variant="heading" style={{ flex: 1 }}>{p.name}</Text>
                  {!p.active ? <Badge label={bt('inactive')} /> : !p.visible_to_students ? <Badge label={bt('hidden')} tone="info" /> : null}
                </View>
                <PlanLine p={p} />
                {p.description ? <Text variant="small" color={palette.ink2}>{p.description}</Text> : null}
                <Text variant="caption" color={palette.ink2}>
                  {[p.all_disciplines ? bt('pf_allDisciplines') : p.discipline_ids.map(discName).join(', '), bt('inUse', { count: p.active_memberships ?? 0 })].join(' · ')}
                </Text>
                {admin ? <Button label={t('members.edit')} size="sm" variant="secondary" icon="edit-2" onPress={() => { setEditing(p); setOpen(true); }} style={{ alignSelf: 'flex-start' }} /> : null}
              </Card>
            </View>
          ))}
        </View>
      )}
      <PlanDialog visible={open} plan={editing} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); setMsg({ tone: 'success', text: bt('planSaved') }); data.reload(); }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
function DiscountDialog({ visible, discount, onClose, onSaved }: { visible: boolean; discount: Discount | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: '', type: 'percent' as 'percent' | 'fixed', value: '', description: '', active: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setErrors({}); setErr(null);
    setF(discount ? { name: discount.name, type: discount.type, value: str(discount.value), description: discount.description ?? '', active: !!discount.active }
      : { name: '', type: 'percent', value: '', description: '', active: true });
  }, [visible, discount]);

  async function save() {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = bt('required');
    const v = num(f.value);
    if (!v || v <= 0) e.value = bt('required');
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true); setErr(null);
    try {
      const body = { name: f.name.trim(), type: f.type, value: v!, description: f.description.trim() || null };
      if (discount) await billingApi.updateDiscount(discount.id, { ...body, active: f.active });
      else await billingApi.createDiscount(body);
      onSaved();
    } catch (x) { setErr(errorMessage(x)); } finally { setSaving(false); }
  }

  return (
    <Dialog visible={visible} onClose={onClose} title={discount ? bt('editDiscount') : bt('newDiscount')}
      actions={<><Button label={t('common.cancel')} variant="ghost" onPress={onClose} /><Button label={t('common.save')} icon="check" loading={saving} onPress={save} /></>}>
      <View style={{ gap: space.md }}>
        <Field label={`${bt('pf_name')} *`} value={f.name} onChangeText={(v) => setF({ ...f, name: v })} error={errors.name} />
        <Select label={bt('df_type')} value={f.type} onChange={(v) => v && setF({ ...f, type: v })}
          options={[{ value: 'percent', label: bt('df_percent') }, { value: 'fixed', label: bt('df_fixed') }]} />
        <Field label={`${bt('df_value')} *${f.type === 'percent' ? ' (%)' : ''}`} value={f.value} onChangeText={(v) => setF({ ...f, value: digits(v) })} keyboardType="decimal-pad" error={errors.value} />
        <Field label={bt('pf_description')} value={f.description} onChangeText={(v) => setF({ ...f, description: v })} />
        {discount ? <SwitchRow label={bt('discountActive')} value={f.active} onChange={(v) => setF({ ...f, active: v })} /> : null}
        {err ? <Notice tone="danger">{err}</Notice> : null}
      </View>
    </Dialog>
  );
}

export const discountLabel = (d: Pick<Discount, 'type' | 'value'>) => (d.type === 'percent' ? `${Number(d.value)} %` : money(d.value));

export function DiscountsTab() {
  const { hasRole } = useSession();
  const admin = hasRole('admin');
  const data = useApi(() => billingApi.discounts(), []);
  const [editing, setEditing] = useState<Discount | null>(null);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <View style={{ gap: space.md }}>
      {admin ? <Button label={bt('newDiscount')} icon="plus" onPress={() => { setEditing(null); setOpen(true); }} style={{ alignSelf: 'flex-end' }} /> : null}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {data.loading ? <Loading /> : (data.data ?? []).length === 0 ? (
        <Card><EmptyState icon="percent" title={bt('noDiscounts')} body={bt('noDiscountsBody')} /></Card>
      ) : (
        <Card padding={0} style={{ overflow: 'hidden' }}>
          {(data.data ?? []).map((d, i) => (
            <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: palette.lineSoft, opacity: d.active ? 1 : 0.55 }}>
              <View style={{ width: 72 }}><Text variant="heading">{discountLabel(d)}</Text></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="bodyStrong">{d.name}</Text>
                <Text variant="caption" color={palette.ink2}>{[d.description, bt('discountInUse', { count: d.in_use })].filter(Boolean).join(' · ')}</Text>
              </View>
              {!d.active ? <Badge label={bt('inactive')} /> : null}
              {admin ? <Button label={t('members.edit')} size="sm" variant="ghost" onPress={() => { setEditing(d); setOpen(true); }} /> : null}
            </View>
          ))}
        </Card>
      )}
      <DiscountDialog visible={open} discount={editing} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); setMsg({ tone: 'success', text: bt('discountSaved') }); data.reload(); }} />
    </View>
  );
}
