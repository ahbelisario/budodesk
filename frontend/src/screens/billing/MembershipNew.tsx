/** Alta de una membresía: plan, personas, quién paga, descuento y primer cargo */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { billingApi, applyDiscount, type Plan } from '../../api/billing';
import { membersApi } from '../../api/members';
import { todayYmd } from '../../api/classes';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Screen } from '../../ui/Screen';
import { Avatar, Button, Card, Divider, Field, Icon, Notice, Text } from '../../ui/primitives';
import { DateField, FormGrid, Select, SwitchRow } from '../../ui/forms';
import { palette, space } from '../../theme/tokens';
import { useIsWide } from '../../navigation/AppShell';
import { t, useLanguage } from '../../i18n';
import { dayShort, fullName, money } from '../../utils/format';
import { PersonPicker, type PickedPerson } from '../members/PersonPicker';
import { PlanLine, bt, planCycle } from './bits';
import { discountLabel } from './CatalogTabs';

const CUSTOM = -1;
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

export function MembershipNew() {
  useLanguage();
  const router = useRouter();
  const wide = useIsWide();
  const params = useLocalSearchParams<{ user_id?: string }>();
  const plans = useApi(() => billingApi.plans(), []);
  const discounts = useApi(() => billingApi.discounts(), []);

  const [planId, setPlanId] = useState<number | null>(null);
  const [people, setPeople] = useState<PickedPerson[]>([]);
  const [adding, setAdding] = useState<PickedPerson | null>(null);
  const [payer, setPayer] = useState<PickedPerson | null>(null);
  const [start, setStart] = useState<string>(todayYmd());
  const [discountId, setDiscountId] = useState<number | null>(null);
  const [customType, setCustomType] = useState<'percent' | 'fixed'>('percent');
  const [customValue, setCustomValue] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [price, setPrice] = useState('');
  const [autoRenew, setAutoRenew] = useState(true);
  const [chargeFirst, setChargeFirst] = useState(true);
  const [chargeSignup, setChargeSignup] = useState(true);
  const [firstDue, setFirstDue] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Preselección desde la ficha del alumno: la persona y, si es menor, su tutor como pagador
  useEffect(() => {
    const id = Number(params.user_id);
    if (!id) return;
    membersApi.get(id).then((m) => {
      const me = { id: m.id, name: fullName(m), photo_url: m.photo_url };
      setPeople([me]);
      const g = m.guardians.find((x) => x.is_primary && x.can_pay) ?? m.guardians.find((x) => x.can_pay);
      setPayer(m.is_minor && g ? { id: g.user_id, name: fullName(g) } : me);
    }).catch(() => {});
  }, [params.user_id]);

  const plan: Plan | undefined = plans.data?.find((p) => p.id === planId);
  const disc = discounts.data?.find((d) => d.id === discountId);
  const base = num(price) ?? plan?.price ?? 0;
  const dType = discountId === CUSTOM ? customType : disc?.type ?? 'none';
  const dValue = discountId === CUSTOM ? num(customValue) ?? 0 : disc?.value ?? 0;
  const final = applyDiscount(base, dType, dValue);
  const firstTotal = (chargeFirst ? final : 0) + (chargeSignup && plan?.signup_fee ? Number(plan.signup_fee) : 0);
  const max = plan?.max_members ?? 1;
  const effectivePayer = payer ?? people[0] ?? null;

  const payerOptions = useMemo(() => {
    const m = new Map<number, PickedPerson>();
    people.forEach((p) => m.set(p.id, p));
    if (payer) m.set(payer.id, payer);
    return [...m.values()];
  }, [people, payer]);

  async function save() {
    const e: Record<string, string> = {};
    if (!plan) e.plan = bt('required');
    if (!people.length) e.people = bt('required');
    else if (people.length > max) e.people = bt('tooMany', { count: max });
    if (discountId === CUSTOM && !(dValue > 0)) e.discount = bt('required');
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true); setErr(null);
    try {
      const ms = await billingApi.createMembership({
        plan_id: plan!.id, member_ids: people.map((p) => p.id), payer_user_id: effectivePayer?.id, start_date: start,
        ...(discountId === CUSTOM ? { discount_type: customType, discount_value: dValue, discount_reason: customReason.trim() || undefined }
          : discountId ? { discount_id: discountId } : {}),
        ...(num(price) != null ? { price: num(price)! } : {}),
        auto_renew: plan!.billing_type === 'recurring' ? autoRenew : false,
        charge_first_period: chargeFirst, charge_signup_fee: chargeSignup,
        ...(firstDue ? { first_due_date: firstDue } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      router.replace(`/memberships/${ms.id}?created=1` as never);
    } catch (x) { setErr(errorMessage(x)); } finally { setSaving(false); }
  }

  return (
    <Screen maxWidth={1100}>
      <Pressable accessibilityRole="link" onPress={() => (router.canGoBack() ? router.back() : router.replace('/memberships' as never))}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}>
        <Icon name="chevron-left" size={18} color={palette.ink2} /><Text variant="smallStrong" color={palette.ink2}>{bt('back')}</Text>
      </Pressable>
      <Text variant="title" accessibilityRole="header">{bt('newTitle')}</Text>

      <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.lg, alignItems: 'flex-start' }}>
        <View style={{ flex: wide ? 2 : undefined, alignSelf: 'stretch', gap: space.lg }}>
          <Card style={{ gap: space.md }}>
            <Select label={`${bt('plan')} *`} value={planId} onChange={(v) => { setPlanId(v); setChargeSignup(true); }} placeholder={bt('pickPlan')} error={errors.plan}
              options={(plans.data ?? []).map((p) => ({ value: p.id, label: `${p.name} · ${money(p.price, p.currency)}`, hint: planCycle(p) }))} />
            {plan ? <PlanLine p={plan} /> : null}
          </Card>

          <Card style={{ gap: space.md }}>
            <View style={{ gap: 2 }}>
              <Text variant="bodyStrong" accessibilityRole="header">{bt('members')} *</Text>
              {plan ? <Text variant="small" color={palette.ink2}>{bt('membersHint', { count: max })}</Text> : null}
            </View>
            {people.map((p) => (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <Avatar name={p.name} photoUrl={p.photo_url} size={36} />
                <Text variant="bodyStrong" style={{ flex: 1 }}>{p.name}</Text>
                <Button label={t('members.remove')} size="sm" variant="ghost" onPress={() => setPeople(people.filter((x) => x.id !== p.id))} />
              </View>
            ))}
            {people.length < max || !plan ? (
              <View style={{ maxWidth: 420 }}>
                <PersonPicker label={bt('addMember')} value={adding} exclude={people.map((p) => p.id)}
                  onChange={(p) => { setAdding(null); if (p) { setPeople([...people, p]); if (!payer) setPayer(p); } }} />
              </View>
            ) : null}
            {errors.people ? <Text variant="small" color={palette.danger}>{errors.people}</Text> : null}
            <Divider />
            <FormGrid>
              <Select label={bt('payer')} value={effectivePayer?.id ?? null} onChange={(v) => setPayer(payerOptions.find((p) => p.id === v) ?? null)}
                options={payerOptions.map((p) => ({ value: p.id, label: p.name }))} />
              <PersonPicker label={bt('payerOther')} value={null} exclude={payerOptions.map((p) => p.id)}
                onChange={(p) => p && setPayer(p)} />
            </FormGrid>
            <Text variant="caption" color={palette.ink2}>{bt('payerHint')}</Text>
          </Card>

          <Card style={{ gap: space.md }}>
            <FormGrid>
              <DateField label={bt('startDate')} value={start} onChange={(v) => setStart(v ?? todayYmd())} />
              <Field label={bt('specialPrice')} value={price} onChangeText={(v) => setPrice(v.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad"
                placeholder={plan ? String(plan.price) : ''} hint={bt('specialPriceHint')} />
              <Select label={bt('discount')} value={discountId} onChange={setDiscountId} allowClear placeholder={bt('noDiscount')} error={errors.discount}
                options={[...(discounts.data ?? []).filter((d) => d.active).map((d) => ({ value: d.id, label: `${d.name} · ${discountLabel(d)}` })),
                  { value: CUSTOM, label: bt('customDiscount') }]} />
              {discountId === CUSTOM ? (
                <Select label={bt('df_type')} value={customType} onChange={(v) => v && setCustomType(v)}
                  options={[{ value: 'percent', label: bt('df_percent') }, { value: 'fixed', label: bt('df_fixed') }]} />
              ) : null}
              {discountId === CUSTOM ? <Field label={`${bt('df_value')}${customType === 'percent' ? ' (%)' : ''}`} value={customValue} onChangeText={(v) => setCustomValue(v.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" /> : null}
              {discountId === CUSTOM ? <Field label={bt('discountReason')} value={customReason} onChangeText={setCustomReason} /> : null}
            </FormGrid>
            {plan?.billing_type === 'recurring' ? <SwitchRow label={bt('autoRenew')} hint={bt('autoRenewHint')} value={autoRenew} onChange={setAutoRenew} /> : null}
            <SwitchRow label={bt('chargeFirst')} value={chargeFirst} onChange={setChargeFirst} />
            {plan?.signup_fee ? <SwitchRow label={bt('chargeSignup', { amount: money(plan.signup_fee, plan.currency) })} value={chargeSignup} onChange={setChargeSignup} /> : null}
            {chargeFirst ? <View style={{ maxWidth: 320 }}><DateField label={bt('firstDue')} value={firstDue} onChange={setFirstDue} /></View> : null}
            <Field label={bt('notes')} value={notes} onChangeText={setNotes} multiline style={{ minHeight: 64, paddingVertical: 12, textAlignVertical: 'top' }} />
          </Card>
        </View>

        <View style={{ flex: wide ? 1 : undefined, alignSelf: 'stretch' }}>
          <Card style={{ gap: space.sm }}>
            <Text variant="bodyStrong">{bt('summary')}</Text>
            {plan ? (
              <>
                <Line label={bt('listPrice')} value={money(base, plan.currency)} />
                {dType !== 'none' && dValue ? <Line label={bt('discount')} value={`− ${money(base - final, plan.currency)}`} /> : null}
                <Line label={bt('finalPrice')} value={`${money(final, plan.currency)}`} strong hint={planCycle(plan)} />
                <Divider />
                <Line label={bt('firstCharge')} value={money(firstTotal, plan.currency)} strong />
                <Text variant="caption" color={palette.ink2}>{bt('startDate')}: {dayShort(start)}{effectivePayer ? ` · ${bt('paidBy')}: ${effectivePayer.name}` : ''}</Text>
              </>
            ) : <Text color={palette.ink2}>{bt('pickPlan')}</Text>}
            {err ? <Notice tone="danger">{err}</Notice> : null}
            <Button label={bt('create')} icon="check" loading={saving} onPress={save} />
          </Card>
        </View>
      </View>
    </Screen>
  );
}

function Line({ label, value, strong, hint }: { label: string; value: string; strong?: boolean; hint?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
      <View style={{ flexShrink: 1 }}>
        <Text variant={strong ? 'bodyStrong' : 'body'} color={strong ? palette.ink : palette.ink2}>{label}</Text>
        {hint ? <Text variant="caption" color={palette.ink2}>{hint}</Text> : null}
      </View>
      <Text variant={strong ? 'heading' : 'body'}>{value}</Text>
    </View>
  );
}
