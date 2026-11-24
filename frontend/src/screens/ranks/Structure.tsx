/** Estructura de grados: disciplinas → programas → grados (ordenables) */
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ranksApi, type DisciplineFull, type RankFull, type RankKind, type Track } from '../../api/ranks';
import type { DisplayStyle } from '../../api/types';
import { ApiError } from '../../api/client';
import { useSession } from '../../session/SessionProvider';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Badge, Button, Card, Divider, EmptyState, Field, Icon, IconButton, Loading, Notice, Text } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { FormGrid, Select, SwitchRow } from '../../ui/forms';
import { palette, radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useIsWide } from '../../navigation/AppShell';
import { t } from '../../i18n';
import { money } from '../../utils/format';
import { ColorField, RankView, ageRange, isHex, numStr, rt, toInt } from './bits';

type Msg = { tone: 'success' | 'danger'; text: string } | null;
const cancelBtn = (onClose: () => void) => <Button label={t('common.cancel')} variant="ghost" onPress={onClose} />;

// ---------------------------------------------------------------------------
function DisciplineDialog({ visible, d, onClose, onSaved }: { visible: boolean; d: DisciplineFull | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(''); const [style, setStyle] = useState(''); const [color, setColor] = useState<string | null>(null);
  const [display, setDisplay] = useState<DisplayStyle>('rank'); const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (visible) { setName(d?.name ?? ''); setStyle(d?.style ?? ''); setColor(d?.color ?? null); setDisplay('rank'); setActive(d ? !!d.active : true); setErr(null); } }, [visible, d]);
  async function save() {
    if (!name.trim()) { setErr(rt('required')); return; }
    if (color && !isHex(color)) { setErr(rt('f_colorHint')); return; }
    setBusy(true); setErr(null);
    try {
      if (d) await ranksApi.updateDiscipline(d.id, { name: name.trim(), style: style.trim() || null, color, active });
      else await ranksApi.createDiscipline({ name: name.trim(), style: style.trim() || null, color, display_style: display });
      onSaved();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog visible={visible} onClose={onClose} title={d ? rt('editDiscipline') : rt('newDiscipline')}
      actions={<>{cancelBtn(onClose)}<Button label={t('common.save')} loading={busy} onPress={save} /></>}>
      <Field label={`${rt('f_name')} *`} value={name} onChangeText={setName} />
      <Field label={rt('f_style')} value={style} onChangeText={setStyle} />
      <ColorField label={rt('f_color')} value={color} onChange={setColor} allowEmpty />
      {!d ? (
        <Select label={rt('f_display')} value={display} onChange={(v) => v && setDisplay(v)}
          options={[{ value: 'rank', label: rt('style_rank') }, { value: 'belt', label: rt('style_belt') }]} />
      ) : <SwitchRow label={rt('f_active')} value={active} onChange={setActive} />}
      {err ? <Notice tone="danger">{err}</Notice> : null}
    </Dialog>
  );
}

function TrackDialog({ visible, disciplineId, track, onClose, onSaved }: { visible: boolean; disciplineId: number; track: Track | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(''); const [min, setMin] = useState(''); const [max, setMax] = useState('');
  const [display, setDisplay] = useState<DisplayStyle>('rank'); const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setName(track?.name ?? ''); setMin(numStr(track?.min_age)); setMax(numStr(track?.max_age));
    setDisplay(track?.display_style ?? 'rank'); setActive(track ? !!track.active : true); setErr(null);
  }, [visible, track]);
  async function save() {
    if (!name.trim()) { setErr(rt('required')); return; }
    setBusy(true); setErr(null);
    try {
      const body = { name: name.trim(), min_age: toInt(min), max_age: toInt(max), display_style: display };
      if (track) await ranksApi.updateTrack(track.id, { ...body, active });
      else await ranksApi.createTrack({ discipline_id: disciplineId, ...body });
      onSaved();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog visible={visible} onClose={onClose} title={track ? rt('editTrack') : rt('newTrack')}
      actions={<>{cancelBtn(onClose)}<Button label={t('common.save')} loading={busy} onPress={save} /></>}>
      <Field label={`${rt('f_name')} *`} value={name} onChangeText={setName} />
      <FormGrid>
        <Field label={rt('f_minAge')} value={min} onChangeText={(v) => setMin(v.replace(/\D/g, ''))} keyboardType="number-pad" />
        <Field label={rt('f_maxAge')} value={max} onChangeText={(v) => setMax(v.replace(/\D/g, ''))} keyboardType="number-pad" />
      </FormGrid>
      <Select label={rt('f_display')} value={display} onChange={(v) => v && setDisplay(v)}
        options={[{ value: 'rank', label: rt('style_rank') }, { value: 'belt', label: rt('style_belt') }]} />
      <Text variant="small" color={palette.ink2}>{rt('styleHint')}</Text>
      {track ? <SwitchRow label={rt('f_active')} value={active} onChange={setActive} /> : null}
      {err ? <Notice tone="danger">{err}</Notice> : null}
    </Dialog>
  );
}

export function RankDialog({ visible, track, rank, onClose, onSaved }: { visible: boolean; track: Track | null; rank: RankFull | null; onClose: () => void; onSaved: () => void }) {
  const blank = { name: '', short_name: '', kind: 'kyu' as RankKind, color: '#FFFFFF', stripe_color: null as string | null, max_stripes: '0',
    min_months: '', min_classes: '', min_age: '', requires_exam: true, exam_fee: '', description: '', active: true };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!visible) return;
    setErr(null); setErrors({});
    setF(rank ? {
      name: rank.name, short_name: rank.short_name ?? '', kind: rank.kind, color: rank.color, stripe_color: rank.stripe_color, max_stripes: String(rank.max_stripes),
      min_months: numStr(rank.min_months), min_classes: numStr(rank.min_classes), min_age: numStr(rank.min_age), requires_exam: !!rank.requires_exam,
      exam_fee: numStr(rank.exam_fee), description: rank.description ?? '', active: !!rank.active,
    } : blank);
  }, [visible, rank]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const belt = track?.display_style === 'belt';

  async function save() {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = rt('required');
    if (!isHex(f.color)) e.color = rt('f_colorHint');
    if (f.stripe_color && !isHex(f.stripe_color)) e.stripe_color = rt('f_colorHint');
    setErrors(e);
    if (Object.keys(e).length) return;
    const body = {
      name: f.name.trim(), short_name: f.short_name.trim() || null, kind: f.kind, color: f.color.toUpperCase(), stripe_color: f.stripe_color,
      max_stripes: toInt(f.max_stripes) ?? 0, min_months: toInt(f.min_months), min_classes: toInt(f.min_classes), min_age: toInt(f.min_age),
      requires_exam: f.requires_exam, exam_fee: f.exam_fee.trim() ? Number(f.exam_fee.replace(',', '.')) : null, description: f.description.trim() || null,
    };
    setBusy(true); setErr(null);
    try {
      if (rank) await ranksApi.updateRank(rank.id, { ...body, active: f.active });
      else await ranksApi.createRank({ ...body, track_id: track!.id });
      onSaved();
    } catch (x) {
      if (x instanceof ApiError) setErrors(Object.fromEntries((x.details ?? []).map((d) => [d.field, d.message])));
      setErr(errorMessage(x));
    } finally { setBusy(false); }
  }

  return (
    <Dialog visible={visible} onClose={onClose} title={rank ? rt('editRank') : `${rt('newRank')} · ${track?.name ?? ''}`} wide
      actions={<>{cancelBtn(onClose)}<Button label={t('common.save')} loading={busy} onPress={save} /></>}>
      <FormGrid>
        <Field label={`${rt('f_name')} *`} value={f.name} onChangeText={set('name')} error={errors.name} placeholder="5° Kyu" />
        <Field label={rt('f_shortName')} value={f.short_name} onChangeText={set('short_name')} placeholder="5K" />
        <Select label={rt('f_kind')} value={f.kind} onChange={(v) => v && set('kind')(v)}
          options={(['kyu', 'dan', 'belt', 'other'] as const).map((k) => ({ value: k, label: rt(`k_${k}`) }))} />
        <Field label={rt('f_maxStripes')} value={f.max_stripes} onChangeText={(v) => set('max_stripes')(v.replace(/\D/g, ''))} keyboardType="number-pad" />
      </FormGrid>
      <FormGrid>
        <ColorField label={rt('f_beltColor')} value={f.color} onChange={(v) => set('color')(v ?? '')} error={errors.color} />
        {belt || Number(f.max_stripes) > 0 ? <ColorField label={rt('f_stripeColor')} value={f.stripe_color} onChange={set('stripe_color')} allowEmpty error={errors.stripe_color} /> : null}
      </FormGrid>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <RankView name={f.name || '—'} color={isHex(f.color) ? f.color : '#FFFFFF'} stripeColor={isHex(f.stripe_color) ? f.stripe_color : null}
          stripes={Math.min(toInt(f.max_stripes) ?? 0, 4)} style={track?.display_style ?? 'rank'} />
      </View>
      <Text variant="bodyStrong">{rt('requirements')}</Text>
      <FormGrid>
        <Field label={rt('f_minMonths')} value={f.min_months} onChangeText={(v) => set('min_months')(v.replace(/\D/g, ''))} keyboardType="number-pad" />
        <Field label={rt('f_minClasses')} value={f.min_classes} onChangeText={(v) => set('min_classes')(v.replace(/\D/g, ''))} keyboardType="number-pad" />
        <Field label={rt('f_rankMinAge')} value={f.min_age} onChangeText={(v) => set('min_age')(v.replace(/\D/g, ''))} keyboardType="number-pad" />
        {f.requires_exam ? <Field label={rt('f_examFee')} value={f.exam_fee} onChangeText={(v) => set('exam_fee')(v.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" /> : null}
      </FormGrid>
      <SwitchRow label={rt('f_requiresExam')} value={f.requires_exam} onChange={set('requires_exam')} />
      <Field label={rt('f_description')} value={f.description} onChangeText={set('description')} multiline style={{ minHeight: 64, paddingVertical: 12, textAlignVertical: 'top' }} />
      {rank ? <SwitchRow label={rt('f_active')} hint={rt('f_activeHint')} value={f.active} onChange={set('active')} /> : null}
      {err ? <Notice tone="danger">{err}</Notice> : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function RankRow({ r, track, i, count, admin, onEdit, onMove }: {
  r: RankFull; track: Track; i: number; count: number; admin: boolean; onEdit: () => void; onMove: (dir: -1 | 1) => void;
}) {
  const router = useRouter();
  const wide = useIsWide();
  const reqs = [
    r.min_months ? rt('reqMonths', { count: r.min_months }) : null,
    r.min_classes ? rt('reqClasses', { count: r.min_classes }) : null,
    r.min_age ? rt('agesFrom', { min: r.min_age }) : null,
    r.requires_exam ? (r.exam_fee ? `${rt('exam')} ${money(r.exam_fee)}` : rt('exam')) : rt('noExam'),
  ].filter(Boolean).join(' · ');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs, opacity: r.active ? 1 : 0.5 }}>
      <Text variant="caption" color={palette.ink3} style={{ width: 22, textAlign: 'right' }}>{r.level}</Text>
      <Pressable accessibilityRole="link" onPress={() => router.push(`/ranks/rank/${r.id}` as never)} style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <RankView name={r.name} color={r.color} stripeColor={r.stripe_color} style={track.display_style} />
        <Text variant="caption" color={palette.ink2} numberOfLines={wide ? 1 : 2}>
          {[reqs, rt('syllabusCount', { count: r.requirements_count ?? 0 }), (r.students_count ?? 0) ? rt('students', { count: r.students_count }) : null].filter(Boolean).join(' · ')}
        </Text>
      </Pressable>
      {!r.active ? <Badge label={rt('inactive')} /> : null}
      {admin ? (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconButton icon="chevron-up" label={rt('moveUp')} onPress={() => onMove(-1)} disabled={i === 0} size="sm" />
          <IconButton icon="chevron-down" label={rt('moveDown')} onPress={() => onMove(1)} disabled={i === count - 1} size="sm" />
          <IconButton icon="edit-2" label={rt('editRank')} onPress={onEdit} size="sm" />
        </View>
      ) : null}
    </View>
  );
}

export function StructureTab() {
  const { hasRole } = useSession();
  const { accent } = useTheme();
  const admin = hasRole('admin');
  const [showInactive, setShowInactive] = useState(false);
  const data = useApi(() => ranksApi.structure(showInactive), [showInactive]);
  const [msg, setMsg] = useState<Msg>(null);
  const [discDlg, setDiscDlg] = useState<{ open: boolean; d: DisciplineFull | null }>({ open: false, d: null });
  const [trackDlg, setTrackDlg] = useState<{ open: boolean; disc: number; track: Track | null }>({ open: false, disc: 0, track: null });
  const [rankDlg, setRankDlg] = useState<{ open: boolean; track: Track | null; rank: RankFull | null }>({ open: false, track: null, rank: null });
  const saved = () => { setMsg({ tone: 'success', text: rt('saved') }); data.reload(); };

  async function move(track: Track, i: number, dir: -1 | 1) {
    const ids = track.ranks.map((r) => r.id);
    const j = i + dir;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await ranksApi.reorder(track.id, ids); data.reload(); } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); }
  }

  return (
    <View style={{ gap: space.md }}>
      <Text variant="small" color={palette.ink2}>{rt('structureIntro')}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
        {admin ? <View style={{ flex: 1, minWidth: 220, maxWidth: 320 }}><SwitchRow label={rt('showInactive')} value={showInactive} onChange={setShowInactive} /></View> : <View style={{ flex: 1 }} />}
        {admin ? <Button label={rt('newDiscipline')} icon="plus" onPress={() => setDiscDlg({ open: true, d: null })} /> : null}
      </View>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {data.loading ? <Loading /> : (data.data ?? []).length === 0 ? (
        <Card><EmptyState icon="award" title={rt('noDisciplines')} body={rt('noDisciplinesBody')} /></Card>
      ) : (data.data ?? []).map((d) => (
        <Card key={d.id} style={{ gap: space.md, borderLeftWidth: 5, borderLeftColor: d.color ?? accent, opacity: d.active ? 1 : 0.6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
            <View style={{ flex: 1, minWidth: 160 }}>
              <Text variant="heading">{d.name}</Text>
              {d.style ? <Text variant="small" color={palette.ink2}>{d.style}</Text> : null}
            </View>
            {!d.active ? <Badge label={rt('inactive')} /> : null}
            {admin ? (
              <View style={{ flexDirection: 'row', gap: space.xs }}>
                <Button label={t('members.edit')} size="sm" variant="ghost" onPress={() => setDiscDlg({ open: true, d })} />
                <Button label={rt('newTrack')} size="sm" variant="secondary" icon="plus" onPress={() => setTrackDlg({ open: true, disc: d.id, track: null })} />
              </View>
            ) : null}
          </View>
          {d.tracks.map((tr) => (
            <View key={tr.id} style={{ gap: space.xs, borderTopWidth: 1, borderTopColor: palette.lineSoft, paddingTop: space.sm, opacity: tr.active ? 1 : 0.6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                <Text variant="bodyStrong">{tr.name}</Text>
                <Badge label={tr.display_style === 'belt' ? rt('style_belt') : rt('style_rank')} />
                {ageRange(tr.min_age, tr.max_age) ? <Badge label={ageRange(tr.min_age, tr.max_age)!} tone="info" /> : null}
                {!tr.active ? <Badge label={rt('inactive')} /> : null}
                <View style={{ flex: 1 }} />
                {admin ? <Pressable accessibilityRole="button" onPress={() => setTrackDlg({ open: true, disc: d.id, track: tr })}><Text variant="small" style={{ textDecorationLine: 'underline' }}>{t('members.edit')}</Text></Pressable> : null}
              </View>
              {tr.ranks.length === 0 ? <Text variant="small" color={palette.ink2}>{rt('noRanks')}</Text> : tr.ranks.map((r, i) => (
                <View key={r.id}>
                  {i > 0 ? <Divider /> : null}
                  <RankRow r={r} track={tr} i={i} count={tr.ranks.length} admin={admin} onEdit={() => setRankDlg({ open: true, track: tr, rank: r })} onMove={(dir) => move(tr, i, dir)} />
                </View>
              ))}
              {admin ? (
                <Pressable accessibilityRole="button" onPress={() => setRankDlg({ open: true, track: tr, rank: null })}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: space.xs, borderRadius: radius.md }}>
                  <Icon name="plus" size={16} color={accent} /><Text variant="smallStrong" color={accent}>{rt('newRank')}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </Card>
      ))}

      <DisciplineDialog visible={discDlg.open} d={discDlg.d} onClose={() => setDiscDlg({ open: false, d: null })} onSaved={() => { setDiscDlg({ open: false, d: null }); saved(); }} />
      <TrackDialog visible={trackDlg.open} disciplineId={trackDlg.disc} track={trackDlg.track} onClose={() => setTrackDlg({ ...trackDlg, open: false })} onSaved={() => { setTrackDlg({ ...trackDlg, open: false }); saved(); }} />
      <RankDialog visible={rankDlg.open} track={rankDlg.track} rank={rankDlg.rank} onClose={() => setRankDlg({ ...rankDlg, open: false })} onSaved={() => { setRankDlg({ ...rankDlg, open: false }); saved(); }} />
    </View>
  );
}
