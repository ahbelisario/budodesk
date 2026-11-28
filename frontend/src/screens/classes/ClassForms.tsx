/** Formularios de horario recurrente y de clase única / edición de una clase */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { classesApi, type Series, type SeriesInput, type SessionDetail, type Weekday, todayYmd } from '../../api/classes';
import { membersApi } from '../../api/members';
import { ApiError } from '../../api/client';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Button, Field, Notice, Text } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { DateField, FormGrid, Select, TimeField } from '../../ui/forms';
import { palette, space } from '../../theme/tokens';
import { t } from '../../i18n';
import { fullName } from '../../utils/format';
import { DayToggles, ct } from './bits';

/** Disciplinas, instructores y lugares para los selectores */
export function useClassOptions(staff = true) {
  const res = useApi(async () => {
    const none = { data: [] as Awaited<ReturnType<typeof membersApi.list>>['data'] };
    const [structure, instructors, admins, owners, locations] = await Promise.all([
      membersApi.structure(),
      staff ? membersApi.list({ role: 'instructor', status: 'active', page_size: 100 }) : none,
      staff ? membersApi.list({ role: 'admin', status: 'active', page_size: 100 }) : none,
      staff ? membersApi.list({ role: 'owner', status: 'active', page_size: 20 }).catch(() => none) : none,
      staff ? classesApi.locations().catch(() => []) : [],
    ]);
    const people = new Map<number, string>();
    [...instructors.data, ...admins.data, ...owners.data].forEach((m) => people.set(m.id, fullName(m)));
    return {
      disciplines: structure.map((d) => ({ value: d.id, label: d.name, color: d.color ?? undefined })),
      instructors: [...people.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
      locations: locations.filter((l) => l.active).map((l) => ({ value: l.id, label: l.name })),
    };
  }, [staff]);
  return res.data ?? { disciplines: [], instructors: [], locations: [] };
}

const toInt = (s: string) => (s.trim() === '' ? null : Number.parseInt(s, 10));
const numStr = (n: number | null | undefined) => (n == null ? '' : String(n));

// ---------------------------------------------------------------------------
export function SeriesDialog({ visible, series, onClose, onSaved }: {
  visible: boolean; series: Series | null; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const opts = useClassOptions();
  const [f, setF] = useState<Omit<SeriesInput, 'capacity' | 'min_age' | 'max_age'> & { capacity: string; min_age: string; max_age: string }>(empty());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function empty() {
    return { title: '', description: '', discipline_id: null, location_id: null, instructor_id: null, days_of_week: [] as Weekday[],
      start_time: '19:00', end_time: '20:30', starts_on: todayYmd(), ends_on: null, capacity: '', min_age: '', max_age: '' };
  }
  useEffect(() => {
    if (!visible) return;
    setErrors({}); setErr(null);
    setF(series ? {
      title: series.title, description: series.description ?? '', discipline_id: series.discipline_id, location_id: series.location_id,
      instructor_id: series.instructor_id, days_of_week: series.days_of_week, start_time: series.start_time.slice(0, 5), end_time: series.end_time.slice(0, 5),
      starts_on: series.starts_on, ends_on: series.ends_on, capacity: numStr(series.capacity), min_age: numStr(series.min_age), max_age: numStr(series.max_age),
    } : { ...empty(), discipline_id: opts.disciplines.length === 1 ? opts.disciplines[0].value : null });
  }, [visible, series]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    const e: Record<string, string> = {};
    if (!f.title.trim()) e.title = ct('required');
    if (!f.days_of_week.length) e.days = ct('pickDay');
    if (!f.start_time) e.start_time = ct('required');
    if (!f.end_time) e.end_time = ct('required');
    else if (f.start_time && f.end_time <= f.start_time) e.end_time = ct('badTime');
    if (!f.starts_on) e.starts_on = ct('required');
    setErrors(e);
    if (Object.keys(e).length) return;
    const body: SeriesInput = {
      title: f.title.trim(), description: f.description?.trim() || null, discipline_id: f.discipline_id ?? null, location_id: f.location_id ?? null,
      instructor_id: f.instructor_id ?? null, days_of_week: f.days_of_week, start_time: f.start_time, end_time: f.end_time,
      starts_on: f.starts_on, ends_on: f.ends_on ?? null, capacity: toInt(f.capacity), min_age: toInt(f.min_age), max_age: toInt(f.max_age),
    };
    setSaving(true); setErr(null);
    try {
      if (series) {
        // Solo lo que cambió, para no tocar sesiones de más
        const before: Record<string, unknown> = {
          title: series.title, description: series.description, discipline_id: series.discipline_id, location_id: series.location_id,
          instructor_id: series.instructor_id, days_of_week: series.days_of_week, start_time: series.start_time.slice(0, 5), end_time: series.end_time.slice(0, 5),
          starts_on: series.starts_on, ends_on: series.ends_on, capacity: series.capacity, min_age: series.min_age, max_age: series.max_age,
        };
        const diff = Object.fromEntries(Object.entries(body).filter(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify(before[k] ?? null)));
        if (Object.keys(diff).length) await classesApi.updateSeries(series.id, diff);
        onSaved(ct('seriesSaved'));
      } else {
        const r = await classesApi.createSeries(body);
        onSaved(ct('seriesCreated', { count: r.sessions_created }));
      }
    } catch (x) {
      if (x instanceof ApiError) setErrors(Object.fromEntries((x.details ?? []).map((d) => [d.field, d.message])));
      setErr(errorMessage(x));
    } finally { setSaving(false); }
  }

  return (
    <Dialog visible={visible} onClose={onClose} title={series ? ct('editSeries') : ct('newSeries')} wide
      actions={<><Button label={t('common.cancel')} variant="ghost" onPress={onClose} /><Button label={t('common.save')} icon="check" loading={saving} onPress={save} /></>}>
      <View style={{ gap: space.md }}>
        <Field label={`${ct('f_title')} *`} value={f.title} onChangeText={set('title')} hint={ct('f_titleHint')} error={errors.title} />
        <View style={{ gap: 6 }}>
          <Text variant="smallStrong">{ct('f_days')} *</Text>
          <DayToggles value={f.days_of_week} onChange={(v) => set('days_of_week')(v as Weekday[])} />
          {errors.days ? <Text variant="small" color={palette.danger}>{errors.days}</Text> : null}
        </View>
        <FormGrid>
          <TimeField label={`${ct('f_start')} *`} value={f.start_time} onChange={(v) => set('start_time')(v ?? '')} error={errors.start_time} />
          <TimeField label={`${ct('f_end')} *`} value={f.end_time} onChange={(v) => set('end_time')(v ?? '')} error={errors.end_time} />
          <Select label={ct('discipline')} value={f.discipline_id} onChange={set('discipline_id')} options={opts.disciplines} allowClear placeholder={ct('f_none')} />
          <Select label={ct('instructor')} value={f.instructor_id} onChange={set('instructor_id')} options={opts.instructors} allowClear placeholder={ct('f_none')} />
          {opts.locations.length ? <Select label={ct('location')} value={f.location_id} onChange={set('location_id')} options={opts.locations} allowClear placeholder={ct('f_none')} /> : null}
          <Field label={ct('f_capacity')} value={f.capacity} onChangeText={(v) => set('capacity')(v.replace(/\D/g, ''))} keyboardType="number-pad" hint={ct('f_capacityHint')} />
          <Field label={ct('f_minAge')} value={f.min_age} onChangeText={(v) => set('min_age')(v.replace(/\D/g, ''))} keyboardType="number-pad" hint={ct('f_agesHint')} />
          <Field label={ct('f_maxAge')} value={f.max_age} onChangeText={(v) => set('max_age')(v.replace(/\D/g, ''))} keyboardType="number-pad" />
          <DateField label={`${ct('f_from')} *`} value={f.starts_on} onChange={(v) => set('starts_on')(v ?? '')} error={errors.starts_on} />
          <DateField label={ct('f_until')} value={f.ends_on} onChange={set('ends_on')} hint={ct('f_untilHint')} />
        </FormGrid>
        <Field label={ct('f_description')} value={f.description ?? ''} onChangeText={set('description')} multiline style={{ minHeight: 72, paddingVertical: 12, textAlignVertical: 'top' }} />
        {err ? <Notice tone="danger">{err}</Notice> : null}
      </View>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
/** Clase única (session = null) o editar una clase concreta */
export function SessionDialog({ visible, session, defaultDate, onClose, onSaved }: {
  visible: boolean; session: SessionDetail | null; defaultDate?: string; onClose: () => void; onSaved: (s: SessionDetail, msg: string) => void;
}) {
  const opts = useClassOptions();
  const [f, setF] = useState({ title: '', discipline_id: null as number | null, instructor_id: null as number | null, location_id: null as number | null,
    session_date: todayYmd(), start_time: '19:00', end_time: '20:30', capacity: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setErrors({}); setErr(null);
    setF(session ? {
      title: session.title, discipline_id: session.discipline_id ?? null, instructor_id: session.instructor_id ?? null, location_id: session.location_id ?? null,
      session_date: session.session_date, start_time: session.start_time.slice(0, 5), end_time: session.end_time.slice(0, 5), capacity: numStr(session.capacity),
    } : { title: '', discipline_id: null, instructor_id: null, location_id: null, session_date: defaultDate ?? todayYmd(), start_time: '19:00', end_time: '20:30', capacity: '' });
  }, [visible, session, defaultDate]);
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    const e: Record<string, string> = {};
    if (!f.title.trim()) e.title = ct('required');
    if (!f.session_date) e.session_date = ct('required');
    if (f.end_time <= f.start_time) e.end_time = ct('badTime');
    setErrors(e);
    if (Object.keys(e).length) return;
    const body = { title: f.title.trim(), discipline_id: f.discipline_id, instructor_id: f.instructor_id, location_id: f.location_id,
      session_date: f.session_date, start_time: f.start_time, end_time: f.end_time, capacity: toInt(f.capacity) };
    setSaving(true); setErr(null);
    try {
      if (session) {
        const before: Record<string, unknown> = { title: session.title, discipline_id: session.discipline_id ?? null, instructor_id: session.instructor_id ?? null,
          location_id: session.location_id ?? null, session_date: session.session_date, start_time: session.start_time.slice(0, 5), end_time: session.end_time.slice(0, 5), capacity: session.capacity };
        const diff = Object.fromEntries(Object.entries(body).filter(([k, v]) => (v ?? null) !== (before[k] ?? null)));
        const s = Object.keys(diff).length ? await classesApi.updateSession(session.id, diff) : session;
        onSaved(s, t('members.saved'));
      } else {
        onSaved(await classesApi.createSession(body), ct('created'));
      }
    } catch (x) { setErr(errorMessage(x)); } finally { setSaving(false); }
  }

  return (
    <Dialog visible={visible} onClose={onClose} title={session ? ct('editTitle') : ct('newClass')} wide
      actions={<><Button label={t('common.cancel')} variant="ghost" onPress={onClose} /><Button label={t('common.save')} icon="check" loading={saving} onPress={save} /></>}>
      <View style={{ gap: space.md }}>
        {session?.series_id ? <Notice tone="info">{ct('editHint')}</Notice> : null}
        <Field label={`${ct('f_title')} *`} value={f.title} onChangeText={set('title')} error={errors.title} />
        <FormGrid>
          <DateField label={`${ct('f_date')} *`} value={f.session_date} onChange={(v) => set('session_date')(v ?? '')} error={errors.session_date} />
          <Field label={ct('f_capacity')} value={f.capacity} onChangeText={(v) => set('capacity')(v.replace(/\D/g, ''))} keyboardType="number-pad" hint={ct('f_capacityHint')} />
          <TimeField label={`${ct('f_start')} *`} value={f.start_time} onChange={(v) => set('start_time')(v ?? '')} />
          <TimeField label={`${ct('f_end')} *`} value={f.end_time} onChange={(v) => set('end_time')(v ?? '')} error={errors.end_time} />
          <Select label={ct('discipline')} value={f.discipline_id} onChange={set('discipline_id')} options={opts.disciplines} allowClear placeholder={ct('f_none')} />
          <Select label={ct('instructor')} value={f.instructor_id} onChange={set('instructor_id')} options={opts.instructors} allowClear placeholder={ct('f_none')} />
          {opts.locations.length ? <Select label={ct('location')} value={f.location_id} onChange={set('location_id')} options={opts.locations} allowClear placeholder={ct('f_none')} /> : null}
        </FormGrid>
        {err ? <Notice tone="danger">{err}</Notice> : null}
      </View>
    </Dialog>
  );
}
