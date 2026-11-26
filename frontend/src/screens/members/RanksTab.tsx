/** Pestaña Grados: progreso por disciplina, temario, otorgar grado/tip, historial */
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { membersApi, type DisciplineDef, type DisciplineProgress, type RankEvent, type Requirement } from '../../api/members';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Badge, Belt, Button, Card, Divider, EmptyState, Field, Icon, Loading, Notice, ProgressBar, SectionHeader, Text } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { DateField, Select } from '../../ui/forms';
import { palette, radius, space, fonts } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useIsWide } from '../../navigation/AppShell';
import { dayShort, dayYear } from '../../utils/format';
import { mt } from './bits';
import { t } from '../../i18n';
import { rankOptions } from './MemberNew';

const REQ_NEXT: Record<Requirement['status'], Requirement['status']> = { pending: 'in_progress', in_progress: 'approved', approved: 'pending' };
const REQ_TONE = { pending: 'neutral', in_progress: 'warning', approved: 'success' } as const;

function Meter({ label, value, pct, ok }: { label: string; value: string; pct: number; ok: boolean }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 160, gap: 6, minWidth: 0 }}>
      <Text variant="caption" color={palette.ink2}>{label}</Text>
      <Text variant="bodyStrong">{value}</Text>
      <ProgressBar value={pct / 100} color={ok ? palette.success : palette.ink} label={label} />
    </View>
  );
}

function Syllabus({ items, canEdit, onToggle, busyId }: { items: Requirement[]; canEdit: boolean; onToggle: (r: Requirement) => void; busyId: number | null }) {
  const groups = items.reduce<Record<string, Requirement[]>>((acc, r) => { (acc[r.category || ''] ??= []).push(r); return acc; }, {});
  return (
    <View style={{ gap: space.sm }}>
      {Object.entries(groups).map(([cat, list]) => (
        <View key={cat} style={{ gap: 4 }}>
          {cat ? <Text variant="overline" color={palette.ink2}>{mt(`cat_${cat}`)}</Text> : null}
          {list.map((r) => (
            <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 40 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="body" numberOfLines={2}>{r.name}{r.mandatory ? '' : ' ·'}</Text>
                {r.description ? <Text variant="caption" color={palette.ink2} numberOfLines={2}>{r.description}</Text> : null}
              </View>
              {canEdit ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`${r.name}: ${mt(`req_${r.status}`)}`} disabled={busyId === r.id}
                  onPress={() => onToggle(r)} style={{ opacity: busyId === r.id ? 0.5 : 1 }}>
                  <Badge label={mt(`req_${r.status}`)} tone={REQ_TONE[r.status]} />
                </Pressable>
              ) : <Badge label={mt(`req_${r.status}`)} tone={REQ_TONE[r.status]} />}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function DisciplineCard({ d, userId, canEdit, onPromote, onChanged }: {
  d: DisciplineProgress; userId: number; canEdit: boolean; onPromote: (d: DisciplineProgress, kind: 'promotion' | 'stripe') => void; onChanged: () => void;
}) {
  const { accent } = useTheme();
  const [reqs, setReqs] = useState(d.requirements);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const p = d.progress;
  const belt = d.display_style === 'belt';

  async function toggle(r: Requirement) {
    const next = REQ_NEXT[r.status];
    setBusy(r.id); setErr(null);
    setReqs((all) => all.map((x) => (x.id === r.id ? { ...x, status: next } : x)));
    try { await membersApi.evaluate(userId, r.id, next); onChanged(); } catch (e) {
      setReqs((all) => all.map((x) => (x.id === r.id ? { ...x, status: r.status } : x)));
      setErr(errorMessage(e));
    } finally { setBusy(null); }
  }

  async function setExam(date: string | null) {
    try { await membersApi.setExamDate(userId, d.discipline_id, date); onChanged(); } catch (e) { setErr(errorMessage(e)); }
  }

  const approved = reqs.filter((r) => r.mandatory && r.status === 'approved').length;
  const total = reqs.filter((r) => r.mandatory).length;

  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' }}>
        <View style={{ gap: 4, flexShrink: 1 }}>
          <Text variant="overline" color={palette.ink2}>{d.discipline}{d.track && d.track !== 'General' ? ` · ${d.track}` : ''}</Text>
          <Text style={{ fontFamily: fonts.display, fontSize: 28, lineHeight: 34 }}>{d.current.name}</Text>
          <Text variant="small" color={palette.ink2}>
            {[mt('since') + ' ' + dayYear(d.current.since_date), d.current.stripes ? `${mt('stripes')}: ${d.current.stripes}` : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {canEdit ? (
          <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {d.current.max_stripes > d.current.stripes ? <Button label={mt('addStripe')} size="sm" variant="secondary" onPress={() => onPromote(d, 'stripe')} /> : null}
            <Button label={mt('promote')} size="sm" variant={p?.eligible ? 'primary' : 'dark'} icon="award" onPress={() => onPromote(d, 'promotion')} />
          </View>
        ) : null}
      </View>
      {belt ? <Belt size="lg" color={d.current.color} stripeColor={d.current.stripe_color} stripes={d.current.stripes} /> : null}

      {d.next && p ? (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
            <Text variant="bodyStrong">{mt('nextRank', { rank: d.next.name })}</Text>
            {p.eligible ? <Badge label={mt('eligible')} tone="success" /> : <Badge label={mt('notEligible')} />}
          </View>
          <View style={{ flexDirection: 'row', gap: space.md, flexWrap: 'wrap' }}>
            {p.months.need ? <Meter label={mt('timeInRank')} value={mt('ofMonths', { have: Math.min(p.months.have, p.months.need), need: p.months.need })} pct={p.months.pct} ok={p.months.ok} /> : null}
            {p.classes.need ? <Meter label={mt('classesInRank')} value={mt('ofClasses', { have: p.classes.have, need: p.classes.need })} pct={p.classes.pct} ok={p.classes.ok} /> : null}
            {p.age?.need ? (p.age.unknown
              ? <Text variant="small" color={palette.ink2}>{mt('ageUnknown', { need: p.age.need })}</Text>
              : <Meter label={mt('minAge')} value={mt('ofAge', { have: p.age.have ?? 0, need: p.age.need })} pct={Math.min(100, ((p.age.have ?? 0) / p.age.need) * 100)} ok={p.age.ok} />) : null}
            {total ? <Meter label={mt('syllabus')} value={mt('ofReqs', { have: approved, need: total })} pct={total ? (approved / total) * 100 : 100} ok={approved === total} /> : null}
          </View>
          <View style={{ maxWidth: 260 }}>
            {canEdit ? <DateField label={mt('nextExam')} value={d.next_exam_date} onChange={setExam} />
              : <Text variant="small" color={palette.ink2}>{mt('nextExam')}: {d.next_exam_date ? dayShort(d.next_exam_date) : mt('noExamDate')}</Text>}
          </View>
          {reqs.length ? (
            <View style={{ gap: space.sm, borderTopWidth: 1, borderTopColor: palette.lineSoft, paddingTop: space.md }}>
              <Text variant="bodyStrong">{mt('syllabus')} · {d.next.name}</Text>
              <Syllabus items={reqs} canEdit={canEdit} onToggle={toggle} busyId={busy} />
            </View>
          ) : null}
        </>
      ) : <Text variant="small" color={palette.ink2}>{mt('topRank')}</Text>}
      {err ? <Notice tone="danger">{err}</Notice> : null}
      <View style={{ height: 3, backgroundColor: d.discipline_color ?? accent, borderRadius: radius.pill, opacity: 0.6 }} />
    </Card>
  );
}

function History({ items, canFix, onEdit, onAdd }: {
  items: RankEvent[]; canFix: boolean; onEdit: (h: RankEvent) => void; onAdd: () => void;
}) {
  if (!items.length && !canFix) return null;
  return (
    <Card>
      <SectionHeader title={mt('history')}
        action={canFix ? <Button label={mt('hAdd')} size="sm" variant="secondary" icon="plus" onPress={onAdd} /> : undefined} />
      {items.map((h, i) => (
        <View key={h.id}>
          {i > 0 ? <Divider /> : null}
          <View style={{ flexDirection: 'row', gap: space.md, paddingVertical: space.xs, alignItems: 'center' }}>
            <Text variant="small" color={palette.ink2} style={{ width: 92 }}>{dayYear(h.awarded_date)}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="bodyStrong" numberOfLines={1}>{h.rank_name}{h.event_type === 'stripe' ? ` · ${mt('stripes')} ${h.stripes}` : ''}</Text>
              <Text variant="caption" color={palette.ink2} numberOfLines={1}>
                {[h.discipline, mt(`ev_${h.event_type}`), h.certificate_number ? `#${h.certificate_number}` : null,
                  h.awarded_by_name ? mt('awardedBy', { name: h.awarded_by_name }) : null].filter(Boolean).join(' · ')}
              </Text>
              {h.notes ? <Text variant="caption" color={palette.ink2}>{h.notes}</Text> : null}
            </View>
            {canFix ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`${mt('hEdit')} ${h.rank_name}`} hitSlop={8} onPress={() => onEdit(h)}
                style={{ padding: 6 }}>
                <Icon name="edit-2" size={16} color={palette.ink2} />
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
    </Card>
  );
}

type FixState =
  | { mode: 'edit'; h: RankEvent; date: string | null; cert: string; notes: string }
  | { mode: 'add'; discipline_id: number; rank_id: number | null; date: string | null; cert: string; notes: string };

/** Corregir un registro del historial o agregar un grado anterior (dueño/admin) */
function FixDialog({ state, setState, userId, structure, disciplines, onDone }: {
  state: FixState | null; setState: (s: FixState | null) => void; userId: number;
  structure: DisciplineDef[]; disciplines: DisciplineProgress[]; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  React.useEffect(() => { setErr(null); setConfirmDel(false); }, [state?.mode, state?.mode === 'edit' ? state.h.id : null]);
  if (!state) return null;
  const close = () => setState(null);

  async function save() {
    if (!state!.date || (state!.mode === 'add' && !state!.rank_id)) { setErr(t('errors.generic')); return; }
    setBusy(true); setErr(null);
    try {
      if (state!.mode === 'edit') {
        await membersApi.editRankEvent(state!.h.id, { awarded_date: state!.date, certificate_number: state!.cert.trim() || null, notes: state!.notes.trim() || null });
      } else {
        await membersApi.addPastRank({ user_id: userId, rank_id: state!.rank_id!, awarded_date: state!.date,
          certificate_number: state!.cert.trim() || null, notes: state!.notes.trim() || null });
      }
      close(); onDone();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  async function del() {
    if (state!.mode !== 'edit') return;
    if (!confirmDel) { setConfirmDel(true); return; }
    setBusy(true); setErr(null);
    try { await membersApi.deleteRankEvent(state!.h.id); close(); onDone(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  const discOptions = [...disciplines.map((d) => ({ value: d.discipline_id, label: d.discipline })),
    ...structure.filter((s) => !disciplines.some((d) => d.discipline_id === s.id)).map((s) => ({ value: s.id, label: s.name }))];
  const dd = state.mode === 'add' ? structure.find((s) => s.id === state.discipline_id) : undefined;
  const title = state.mode === 'edit' ? mt('hEditTitle', { rank: state.h.rank_name })
    : mt('hAddTitle', { discipline: dd?.name ?? '' });

  return (
    <Dialog visible title={title} onClose={close}
      actions={<>
        {state.mode === 'edit' ? (
          <Button label={confirmDel ? mt('hDeleteConfirm') : mt('hDelete')} variant={confirmDel ? 'danger' : 'ghost'} icon="trash-2"
            loading={busy && confirmDel} onPress={del} />
        ) : null}
        <Button label={t('common.cancel')} variant="ghost" onPress={close} />
        <Button label={t('common.save')} icon="check" loading={busy && !confirmDel} onPress={save} />
      </>}>
      <View style={{ gap: space.md }}>
        <Text variant="small" color={palette.ink2}>{state.mode === 'edit' ? mt('hEditHint') : mt('hAddHint')}</Text>
        {state.mode === 'add' ? (
          <>
            {discOptions.length > 1 ? (
              <Select label={mt('hDiscipline')} value={state.discipline_id}
                onChange={(v) => v && setState({ ...state, discipline_id: v, rank_id: null })} options={discOptions} />
            ) : null}
            <Select label={mt('rank')} value={state.rank_id} onChange={(v) => setState({ ...state, rank_id: v })} options={rankOptions(dd)} />
          </>
        ) : null}
        <DateField label={mt('awardDate')} value={state.date} onChange={(v) => setState({ ...state, date: v })} />
        <Field label={mt('hCert')} value={state.cert} onChangeText={(v) => setState({ ...state, cert: v })} maxLength={50} />
        <Field label={mt('promotionNotes')} value={state.notes} onChangeText={(v) => setState({ ...state, notes: v })} />
        {err ? <Notice tone="danger">{err}</Notice> : null}
      </View>
    </Dialog>
  );
}

type PromoteState = { discipline_id: number; discipline: string; kind: 'promotion' | 'stripe' | 'initial'; rank_id: number | null; stripes: number; max: number; date: string | null; notes: string };

export function RanksTab({ userId, canEdit, canFix = false, structure, onChanged }: {
  userId: number; canEdit: boolean; structure: DisciplineDef[]; onChanged: () => void;
  /** Dueño/admin: corregir el historial (fechas, grados anteriores) */
  canFix?: boolean;
}) {
  const data = useApi(() => membersApi.progress(userId), [userId]);
  const [dlg, setDlg] = useState<PromoteState | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [fix, setFix] = useState<FixState | null>(null);
  const wide = useIsWide();

  if (data.loading) return <Loading />;
  if (data.error) return <Notice tone="danger">{data.error}</Notice>;
  const disciplines = data.data?.disciplines ?? [];
  const missing = structure.filter((s) => !disciplines.some((d) => d.discipline_id === s.id));

  function open(d: DisciplineProgress, kind: 'promotion' | 'stripe') {
    setErr(null);
    setDlg({
      discipline_id: d.discipline_id, discipline: d.discipline, kind,
      rank_id: kind === 'stripe' ? d.current.rank_id : d.next?.rank_id ?? d.current.rank_id,
      stripes: kind === 'stripe' ? d.current.stripes + 1 : 0, max: d.current.max_stripes, date: null, notes: '',
    });
  }

  async function save() {
    if (!dlg?.rank_id) return;
    setSaving(true); setErr(null);
    try {
      await membersApi.promote({
        user_id: userId, rank_id: dlg.rank_id, stripes: dlg.stripes,
        event_type: dlg.kind === 'initial' ? 'initial' : dlg.kind, awarded_date: dlg.date ?? undefined, notes: dlg.notes.trim() || null,
      });
      setDlg(null); setOk(mt('promoted'));
      data.reload(); onChanged();
    } catch (e) { setErr(errorMessage(e)); } finally { setSaving(false); }
  }

  const dd = dlg ? structure.find((s) => s.id === dlg.discipline_id) : undefined;
  const maxStripes = dlg?.rank_id ? dd?.tracks.flatMap((t) => t.ranks).find((r) => r.id === dlg.rank_id)?.max_stripes ?? 0 : 0;

  return (
    <View style={{ gap: space.lg }}>
      {ok ? <Notice tone="success">{ok}</Notice> : null}
      {disciplines.length === 0 ? (
        <Card><EmptyState icon="award" title={mt('noRanks')} body={canEdit ? mt('noRanksBody') : undefined} /></Card>
      ) : (
        <View style={{ flexDirection: wide ? 'row' : 'column', flexWrap: wide ? 'wrap' : 'nowrap', gap: space.lg }}>
          {disciplines.map((d) => (
            <View key={`${d.discipline_id}-${d.current.rank_id}-${d.current.stripes}`} style={{ flexGrow: 1, flexBasis: wide ? 420 : undefined, minWidth: 0 }}>
              <DisciplineCard d={d} userId={userId} canEdit={canEdit} onPromote={open} onChanged={() => { data.reload(); onChanged(); }} />
            </View>
          ))}
        </View>
      )}
      {canEdit && missing.length ? (
        <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
          {missing.map((m) => (
            <Button key={m.id} label={`${mt('initialRankTitle')} · ${m.name}`} size="sm" variant="secondary" icon="plus"
              onPress={() => { setErr(null); setDlg({ discipline_id: m.id, discipline: m.name, kind: 'initial', rank_id: null, stripes: 0, max: 0, date: null, notes: '' }); }} />
          ))}
        </View>
      ) : null}
      <History items={data.data?.history ?? []} canFix={canFix}
        onEdit={(h) => { setOk(null); setFix({ mode: 'edit', h, date: h.awarded_date.slice(0, 10), cert: h.certificate_number ?? '', notes: h.notes ?? '' }); }}
        onAdd={() => {
          setOk(null);
          const first = disciplines[0]?.discipline_id ?? structure[0]?.id;
          if (first) setFix({ mode: 'add', discipline_id: first, rank_id: null, date: null, cert: '', notes: '' });
        }} />
      <FixDialog state={fix} setState={setFix} userId={userId} structure={structure} disciplines={disciplines}
        onDone={() => { setOk(mt('hSaved')); data.reload(); onChanged(); }} />

      <Dialog visible={!!dlg} onClose={() => setDlg(null)}
        title={dlg ? (dlg.kind === 'stripe' ? mt('stripeTitle', { discipline: dlg.discipline }) : dlg.kind === 'initial' ? `${mt('initialRankTitle')} · ${dlg.discipline}` : mt('promoteTitle', { discipline: dlg.discipline })) : ''}
        actions={<>
          <Button label={t('common.cancel')} variant="ghost" onPress={() => setDlg(null)} />
          <Button label={mt('promote')} icon="award" loading={saving} disabled={!dlg?.rank_id} onPress={save} />
        </>}>
        {dlg ? (
          <View style={{ gap: space.md }}>
            {dlg.kind !== 'stripe' ? (
              <Select label={mt('rank')} value={dlg.rank_id} onChange={(v) => setDlg({ ...dlg, rank_id: v, stripes: 0 })} options={rankOptions(dd)} />
            ) : null}
            {(dlg.kind === 'stripe' || maxStripes > 0) ? (
              <Select label={mt('stripes')} value={dlg.stripes} onChange={(v) => setDlg({ ...dlg, stripes: v ?? 0 })}
                options={Array.from({ length: (dlg.kind === 'stripe' ? dlg.max : maxStripes) + 1 }, (_, i) => ({ value: i, label: String(i) }))} />
            ) : null}
            <DateField label={mt('awardDate')} value={dlg.date} onChange={(v) => setDlg({ ...dlg, date: v })} />
            <Field label={mt('promotionNotes')} value={dlg.notes} onChangeText={(v) => setDlg({ ...dlg, notes: v })} />
            {err ? <Notice tone="danger">{err}</Notice> : null}
          </View>
        ) : null}
      </Dialog>
    </View>
  );
}
