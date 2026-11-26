/** Plataforma → Planes: nombre y límites de cada plan de BudoDesk (Básico, Pro) */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { platformApi, type SaasPlan } from '../../api/platform';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Button, Card, Field, Loading, Notice, Text } from '../../ui/primitives';
import { FormGrid, SwitchRow } from '../../ui/forms';
import { useIsWide } from '../../navigation/AppShell';
import { palette, space } from '../../theme/tokens';
import { t } from '../../i18n';

const pt = (k: string, o?: Record<string, unknown>) => t(`platform.${k}`, o);
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
const txt = (n: number | null) => (n == null ? '' : String(n));

function PlanCard({ p, onSaved }: { p: SaasPlan; onSaved: (p: SaasPlan) => void }) {
  const wide = useIsWide();
  const [name, setName] = useState(p.name);
  const [students, setStudents] = useState(txt(p.max_students));
  const [locations, setLocations] = useState(txt(p.max_locations));
  const [finance, setFinance] = useState(p.finance);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  useEffect(() => { setName(p.name); setStudents(txt(p.max_students)); setLocations(txt(p.max_locations)); setFinance(p.finance); }, [p]);
  const dirty = name.trim() !== p.name || numOrNull(students) !== p.max_students || numOrNull(locations) !== p.max_locations || finance !== p.finance;

  async function save() {
    const ms = numOrNull(students); const ml = numOrNull(locations);
    if (!name.trim() || (ms != null && ms < 1) || (ml != null && ml < 1)) { setMsg({ tone: 'danger', text: pt('required') }); return; }
    setBusy(true); setMsg(null);
    try {
      onSaved(await platformApi.savePlan(p.code, { name: name.trim(), max_students: ms, max_locations: ml, finance }));
      setMsg({ tone: 'success', text: pt('pl_saved') });
    } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(false); }
  }

  return (
    <Card style={{ gap: space.md }}>
      <View style={{ gap: 2 }}>
        <Text variant="bodyStrong">{p.name}</Text>
        <Text variant="small" color={palette.ink2}>{`${p.code} · ${pt('pl_dojos', { count: p.dojos ?? 0 })}`}</Text>
      </View>
      <Field label={pt('pl_name')} value={name} onChangeText={setName} maxLength={60} />
      <FormGrid>
        <Field label={pt('pl_students')} value={students} keyboardType="number-pad" hint={pt('pl_unlimitedHint')}
          onChangeText={(x) => setStudents(x.replace(/\D/g, '').slice(0, 6))} />
        <Field label={pt('pl_locations')} value={locations} keyboardType="number-pad" hint={pt('pl_unlimitedHint')}
          onChangeText={(x) => setLocations(x.replace(/\D/g, '').slice(0, 4))} />
      </FormGrid>
      <SwitchRow label={pt('pl_finance')} value={finance} onChange={setFinance} />
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
        <Button label={pt('save')} variant="dark" icon="check" loading={busy} disabled={!dirty} onPress={save} fullWidth={!wide} />
      </View>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </Card>
  );
}

export function PlansTab() {
  const data = useApi(() => platformApi.plans(), []);
  if (data.loading && !data.data) return <Loading />;
  if (data.error && !data.data) return <Notice tone="danger">{data.error}</Notice>;
  const plans = data.data ?? [];
  return (
    <View style={{ gap: space.md }}>
      <Text variant="small" color={palette.ink2}>{pt('pl_intro')}</Text>
      {plans.map((p) => (
        <PlanCard key={p.code} p={p} onSaved={(np) => data.setData(plans.map((x) => (x.code === np.code ? { ...np, dojos: x.dojos } : x)))} />
      ))}
    </View>
  );
}
