/** Pestañas Exámenes y Listos para examen, y el diálogo de examen */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ranksApi, type Eligible, type ExamDetail, type ExamInput } from '../../api/ranks';
import { todayYmd } from '../../api/classes';
import { useSession } from '../../session/SessionProvider';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Avatar, Button, Card, Divider, EmptyState, Field, Icon, Loading, Notice, Text } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { DateField, FilterChips, FormGrid, Select, SwitchRow, TimeField } from '../../ui/forms';
import { palette, radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useIsWide } from '../../navigation/AppShell';
import { t } from '../../i18n';
import { dayLong, dayShort, fullName, hm } from '../../utils/format';
import { ExamStatusBadge, rt } from './bits';

type Msg = { tone: 'success' | 'danger' | 'info'; text: string } | null;

// ---------------------------------------------------------------------------
export function ExamDialog({ visible, exam, defaultDiscipline, onClose, onSaved }: {
  visible: boolean; exam: ExamDetail | null; defaultDiscipline?: number; onClose: () => void; onSaved: (e: ExamDetail) => void;
}) {
  const structure = useApi(() => ranksApi.structure(), []);
  const [f, setF] = useState<{ discipline_id: number | null; title: string; exam_date: string | null; start_time: string | null; examiner_name: string; registration_deadline: string | null; notes: string }>(
    { discipline_id: null, title: '', exam_date: null, start_time: null, examiner_name: '', registration_deadline: null, notes: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setErr(null);
    const discs = structure.data ?? [];
    setF(exam ? {
      discipline_id: exam.discipline_id, title: exam.title, exam_date: exam.exam_date, start_time: exam.start_time?.slice(0, 5) ?? null,
      examiner_name: exam.examiner_name ?? '', registration_deadline: exam.registration_deadline, notes: exam.notes ?? '',
    } : { discipline_id: defaultDiscipline ?? (discs.length === 1 ? discs[0].id : null), title: '', exam_date: null, start_time: null, examiner_name: '', registration_deadline: null, notes: '' });
  }, [visible, exam, structure.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    if (!f.discipline_id || !f.title.trim() || !f.exam_date) { setErr(rt('required')); return; }
    setBusy(true); setErr(null);
    try {
      const body: ExamInput = { title: f.title.trim(), exam_date: f.exam_date, start_time: f.start_time, examiner_name: f.examiner_name.trim() || null,
        registration_deadline: f.registration_deadline, notes: f.notes.trim() || null };
      const saved = exam ? await ranksApi.updateExam(exam.id, body)
        : await ranksApi.createExam({ ...body, discipline_id: f.discipline_id, title: body.title!, exam_date: body.exam_date!, status: 'open' });
      onSaved(saved);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog visible={visible} onClose={onClose} title={exam ? rt('editExam') : rt('newExam')} wide
      actions={<><Button label={t('common.cancel')} variant="ghost" onPress={onClose} /><Button label={t('common.save')} loading={busy} onPress={save} /></>}>
      <FormGrid>
        <Select label={`${rt('e_discipline')} *`} value={f.discipline_id} onChange={set('discipline_id')} disabled={!!exam}
          options={(structure.data ?? []).map((d) => ({ value: d.id, label: d.name }))} />
        <Field label={`${rt('e_title')} *`} value={f.title} onChangeText={set('title')} placeholder={rt('e_titleHint')} />
        <DateField label={`${rt('e_date')} *`} value={f.exam_date} onChange={set('exam_date')} />
        <TimeField label={rt('e_time')} value={f.start_time} onChange={set('start_time')} />
        <Field label={rt('e_examiner')} value={f.examiner_name} onChangeText={set('examiner_name')} hint={rt('e_examinerHint')} />
        <DateField label={rt('e_deadline')} value={f.registration_deadline} onChange={set('registration_deadline')} />
      </FormGrid>
      <Field label={rt('e_notes')} value={f.notes} onChangeText={set('notes')} multiline style={{ minHeight: 64, paddingVertical: 12, textAlignVertical: 'top' }} />
      {err ? <Notice tone="danger">{err}</Notice> : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
export function ExamsTab() {
  const router = useRouter();
  const wide = useIsWide();
  const { accent } = useTheme();
  const { hasRole } = useSession();
  const canManage = hasRole('admin', 'instructor');
  const [which, setWhich] = useState<'upcoming' | 'past'>('upcoming');
  const data = useApi(() => ranksApi.exams(), []);
  const [open, setOpen] = useState(false);
  const today = todayYmd();
  const rows = useMemo(() => {
    const all = data.data ?? [];
    const up = all.filter((e) => e.exam_date >= today && !['completed', 'cancelled'].includes(e.status)).sort((a, b) => a.exam_date.localeCompare(b.exam_date));
    return which === 'upcoming' ? up : all.filter((e) => !up.includes(e));
  }, [data.data, which, today]);

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
        <FilterChips label={rt('exams')} value={which} onChange={setWhich} options={[{ key: 'upcoming', label: rt('upcoming') }, { key: 'past', label: rt('past') }]} />
        <View style={{ flex: 1 }} />
        {canManage ? <Button label={rt('newExam')} icon="plus" onPress={() => setOpen(true)} /> : null}
      </View>
      {data.error ? <Notice tone="danger">{data.error}</Notice> : null}
      {data.loading ? <Loading /> : rows.length === 0 ? (
        <Card><EmptyState icon="award" title={rt('noExams')} body={canManage ? rt('noExamsBody') : undefined} /></Card>
      ) : rows.map((e) => (
        <Pressable key={e.id} accessibilityRole="link" onPress={() => router.push(`/ranks/exams/${e.id}` as never)}>
          <Card style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
            <View style={{ width: 56, alignItems: 'center', paddingVertical: 6, borderRadius: radius.md, backgroundColor: palette.paper }}>
              <Text variant="caption" color={palette.ink2}>{dayShort(e.exam_date).split(' ')[1] ?? ''}</Text>
              <Text variant="heading" color={accent}>{Number(e.exam_date.slice(8, 10))}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <Text variant="bodyStrong" numberOfLines={2}>{e.title}</Text>
              {!wide ? <View style={{ flexDirection: 'row' }}><ExamStatusBadge status={e.status} /></View> : null}
              <Text variant="small" color={palette.ink2} numberOfLines={1}>{[e.discipline, e.start_time ? hm(e.start_time) : null, e.examiner_name].filter(Boolean).join(' · ')}</Text>
              <Text variant="caption" color={palette.ink2}>
                {e.status === 'completed' ? rt('passedOf', { passed: e.passed_count, total: e.candidates_count }) : rt('candidates', { count: e.candidates_count })}
              </Text>
            </View>
            {wide ? <ExamStatusBadge status={e.status} /> : null}
          </Card>
        </Pressable>
      ))}
      <ExamDialog visible={open} exam={null} onClose={() => setOpen(false)} onSaved={(e) => { setOpen(false); router.push(`/ranks/exams/${e.id}?created=1` as never); }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
/** Lista de alumnos listos (o casi) con selección para inscribirlos a un examen */
export function EligibleList({ disciplineId, exclude = [], onEnroll, enrollLabel }: {
  disciplineId?: number; exclude?: number[]; onEnroll?: (ids: number[], rows: Eligible[]) => Promise<void> | void; enrollLabel?: (n: number) => string;
}) {
  const wide = useIsWide();
  const [near, setNear] = useState(false);
  const data = useApi(() => ranksApi.eligible(disciplineId, near), [disciplineId, near]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const rows = (data.data ?? []).filter((r) => !exclude.includes(r.user_id));
  const key = (r: Eligible) => `${r.user_id}-${r.discipline_id}`;
  useEffect(() => { setSel(new Set()); }, [disciplineId, near]);

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ maxWidth: 420 }}><SwitchRow label={rt('includeNear')} value={near} onChange={setNear} /></View>
      {data.loading ? <Loading /> : rows.length === 0 ? <Card><EmptyState icon="check-circle" title={rt('noReady')} body={rt('noReadyBody')} /></Card> : (
        <Card padding={0} style={{ overflow: 'hidden' }}>
          {onEnroll ? (
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: sel.size === rows.length }}
              onPress={() => setSel(sel.size === rows.length ? new Set() : new Set(rows.map(key)))}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, backgroundColor: palette.paper }}>
              <Icon name={sel.size === rows.length ? 'check-square' : 'square'} size={18} />
              <Text variant="smallStrong">{rt('selectAll')}</Text>
            </Pressable>
          ) : null}
          {rows.map((r, i) => {
            const on = sel.has(key(r));
            const name = fullName(r);
            return (
              <View key={key(r)}>
                {i > 0 || onEnroll ? <Divider /> : null}
                <Pressable accessibilityRole={onEnroll ? 'checkbox' : 'none'} accessibilityState={onEnroll ? { checked: on } : undefined} disabled={!onEnroll}
                  onPress={() => { const n = new Set(sel); if (on) n.delete(key(r)); else n.add(key(r)); setSel(n); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md }}>
                  {onEnroll ? <Icon name={on ? 'check-square' : 'square'} size={18} /> : null}
                  <Avatar name={name} photoUrl={r.photo_url} size={36} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>{name}</Text>
                    <Text variant="small" color={palette.ink2} numberOfLines={wide ? 1 : 2}>{r.discipline} · {r.current_rank} → {r.next_rank}</Text>
                    <Text variant="caption" color={palette.ink2} numberOfLines={wide ? 1 : 2}>
                      {[r.next_min_months ? rt('monthsOf', { have: Math.min(r.months_in_rank, r.next_min_months), need: r.next_min_months }) : null,
                        r.next_min_classes ? rt('classesOf', { have: r.classes_in_rank, need: r.next_min_classes }) : null,
                        r.req_total ? rt('syllabusOf', { have: r.req_approved, need: r.req_total }) : null,
                        r.next_exam_date ? `${t('members.nextExam')}: ${dayShort(r.next_exam_date)}` : null].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: r.eligible ? palette.successBg : palette.warningBg }}>
                    <Text variant="caption" color={r.eligible ? palette.success : palette.warning}>{r.eligible ? rt('ready') : rt('near')}</Text>
                  </View>
                </Pressable>
              </View>
            );
          })}
        </Card>
      )}
      {onEnroll && sel.size ? (
        <Button label={enrollLabel ? enrollLabel(sel.size) : rt('addSelected', { count: sel.size })} icon="user-check" loading={busy} style={{ alignSelf: wide ? 'flex-end' : 'stretch' }}
          onPress={async () => {
            setBusy(true);
            try {
              const chosen = rows.filter((r) => sel.has(key(r)));
              await onEnroll([...new Set(chosen.map((r) => r.user_id))], chosen);
              setSel(new Set());
              data.reload();
            } finally { setBusy(false); }
          }} />
      ) : null}
    </View>
  );
}

export function ReadyTab() {
  const router = useRouter();
  const { hasRole } = useSession();
  const canManage = hasRole('admin', 'instructor');
  const structure = useApi(() => ranksApi.structure(), []);
  const exams = useApi(() => ranksApi.exams('upcoming'), []);
  const [disc, setDisc] = useState<string>('all');
  const [pick, setPick] = useState<{ ids: number[]; discipline: number } | null>(null);
  const [examId, setExamId] = useState<number | null>(null);
  const [chargeFee, setChargeFee] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const discs = structure.data ?? [];
  const options = [{ key: 'all', label: rt('allDisciplines') }, ...discs.map((d) => ({ key: String(d.id), label: d.name }))];
  const examOptions = (exams.data ?? []).filter((e) => !pick || e.discipline_id === pick.discipline).filter((e) => ['planned', 'open', 'closed'].includes(e.status));

  async function enroll() {
    if (!pick || !examId) return;
    setBusy(true); setMsg(null);
    try {
      const r = await ranksApi.addCandidates(examId, pick.ids, chargeFee);
      setPick(null);
      setMsg({ tone: 'success', text: rt('added', { count: r.added.length }) + (r.skipped.length ? ` ${rt('skipped', { list: r.skipped.map((s) => s.reason).join('; ') })}` : '') });
      router.push(`/ranks/exams/${examId}` as never);
    } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(false); }
  }

  return (
    <View style={{ gap: space.md }}>
      <Text variant="small" color={palette.ink2}>{rt('readyIntro')}</Text>
      {discs.length > 1 ? <FilterChips label={rt('e_discipline')} value={disc} onChange={setDisc} options={options} /> : null}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <EligibleList disciplineId={disc === 'all' ? undefined : Number(disc)}
        onEnroll={canManage ? (ids, rows) => {
          const d = rows[0].discipline_id;
          setExamId((exams.data ?? []).find((e) => e.discipline_id === d && ['planned', 'open', 'closed'].includes(e.status))?.id ?? null);
          setPick({ ids, discipline: d });
        } : undefined} />
      <Dialog visible={!!pick} onClose={() => setPick(null)} title={rt('pickExam')}
        actions={<><Button label={t('common.cancel')} variant="ghost" onPress={() => setPick(null)} /><Button label={rt('enroll')} loading={busy} disabled={!examId} onPress={enroll} /></>}>
        {examOptions.length ? (
          <>
            <Select label={rt('exams')} value={examId} onChange={setExamId}
              options={examOptions.map((e) => ({ value: e.id, label: e.title, hint: `${dayLong(e.exam_date)} · ${e.discipline}` }))} />
            <SwitchRow label={rt('chargeFee')} value={chargeFee} onChange={setChargeFee} />
            <Text variant="small" color={palette.ink2}>{rt('addCandidatesHint')}</Text>
          </>
        ) : <Notice tone="info">{rt('noOpenExam')}</Notice>}
      </Dialog>
    </View>
  );
}
