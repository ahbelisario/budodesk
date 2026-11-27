/** Plataforma → Plantillas: plantillas de grados que los dojos usan para crear disciplinas */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View, type TextStyle } from 'react-native';
import { platformApi } from '../../api/platform';
import type { RankTemplate, TemplateRank } from '../../api/ranks';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Badge, Belt, Button, Card, EmptyState, Field, Icon, IconButton, Loading, Notice, Text } from '../../ui/primitives';
import { FormGrid, SearchField, Select, SwitchRow } from '../../ui/forms';
import { Dialog } from '../../ui/Dialog';
import { useIsWide } from '../../navigation/AppShell';
import { fonts, palette, radius, space } from '../../theme/tokens';
import { t } from '../../i18n';

const pt = (k: string, o?: Record<string, unknown>) => t(`platform.${k}`, o);
type Track = RankTemplate['tracks'][number];
type Draft = Omit<RankTemplate, 'key'> & { key?: string; builtin?: boolean; active: boolean };

const isHex = (s: string) => /^#[0-9A-Fa-f]{6}$/.test(s);
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
const blankRank = (prev?: TemplateRank): TemplateRank => ({
  name: '', short_name: null, kind: prev?.kind ?? 'belt', color: prev?.color ?? '#FFFFFF', stripe_color: null, max_stripes: 0,
  min_months: null, min_classes: null, min_age: null, requires_exam: true,
});
const blankTrack = (): Track => ({ name: 'General', min_age: null, max_age: null, display_style: 'belt', ranks: [blankRank()] });
const countRanks = (x: { tracks: Track[] }) => x.tracks.reduce((a, tr) => a + tr.ranks.length, 0);

// Campo chico para la tabla de grados
function Mini({ label, value, onChange, width, numeric, error }: { label: string; value: string; onChange: (v: string) => void; width: number; numeric?: boolean; error?: boolean }) {
  return (
    <TextInput accessibilityLabel={label} placeholder={label} placeholderTextColor={palette.ink3} value={value} onChangeText={onChange}
      keyboardType={numeric ? 'number-pad' : 'default'} autoCapitalize="none" autoCorrect={false}
      style={{ width, height: 36, borderWidth: 1, borderColor: error ? palette.danger : palette.line, borderRadius: radius.sm, paddingHorizontal: 8,
        fontFamily: fonts.body, fontSize: 14, color: palette.ink, backgroundColor: palette.surface, outlineWidth: 0 } as TextStyle} />
  );
}

const COLS: [string, number][] = [['c_name', 190], ['c_color', 92], ['c_stripe', 92], ['c_stripes', 56], ['c_months', 64], ['c_classes', 64], ['c_age', 56]];

function RankRows({ track, onChange }: { track: Track; onChange: (tr: Track) => void }) {
  const set = (i: number, patch: Partial<TemplateRank>) => onChange({ ...track, ranks: track.ranks.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const move = (i: number, d: number) => {
    const rs = [...track.ranks]; const [x] = rs.splice(i, 1); rs.splice(i + d, 0, x); onChange({ ...track, ranks: rs });
  };
  const num = (s: string) => (s.replace(/[^0-9]/g, '') === '' ? null : Number(s.replace(/[^0-9]/g, '')));
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 6, paddingLeft: 50 }}>
        {COLS.map(([k, w]) => <Text key={k} variant="small" color={palette.ink2} style={{ width: w }}>{pt(`rt_${k}`)}</Text>)}
      </View>
      {track.ranks.map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 44, alignItems: 'center', overflow: 'hidden' }}>
            {isHex(r.color) ? <Belt size="sm" color={r.color} stripeColor={r.stripe_color && isHex(r.stripe_color) ? r.stripe_color : null} /> : null}
          </View>
          <Mini label={pt('rt_c_name')} width={190} value={r.name} error={!r.name.trim()} onChange={(v) => set(i, { name: v })} />
          <Mini label={pt('rt_c_color')} width={92} value={r.color} error={!isHex(r.color)} onChange={(v) => set(i, { color: v.trim() })} />
          <Mini label={pt('rt_c_stripe')} width={92} value={r.stripe_color ?? ''} error={!!r.stripe_color && !isHex(r.stripe_color)}
            onChange={(v) => set(i, { stripe_color: v.trim() || null })} />
          <Mini label={pt('rt_c_stripes')} width={56} numeric value={String(r.max_stripes || '')} onChange={(v) => set(i, { max_stripes: num(v) ?? 0 })} />
          <Mini label={pt('rt_c_months')} width={64} numeric value={r.min_months == null ? '' : String(r.min_months)} onChange={(v) => set(i, { min_months: num(v) })} />
          <Mini label={pt('rt_c_classes')} width={64} numeric value={r.min_classes == null ? '' : String(r.min_classes)} onChange={(v) => set(i, { min_classes: num(v) })} />
          <Mini label={pt('rt_c_age')} width={56} numeric value={r.min_age == null ? '' : String(r.min_age)} onChange={(v) => set(i, { min_age: num(v) })} />
          <IconButton size="sm" icon="arrow-up" label={pt('rt_up')} disabled={i === 0} onPress={() => move(i, -1)} />
          <IconButton size="sm" icon="arrow-down" label={pt('rt_down')} disabled={i === track.ranks.length - 1} onPress={() => move(i, 1)} />
          <IconButton size="sm" icon="trash-2" label={pt('rt_removeRank')} disabled={track.ranks.length === 1}
            onPress={() => onChange({ ...track, ranks: track.ranks.filter((_, j) => j !== i) })} />
        </View>
      ))}
      <View style={{ alignSelf: 'flex-start' }}>
        <Button size="sm" variant="ghost" icon="plus" label={pt('rt_addRank')}
          onPress={() => onChange({ ...track, ranks: [...track.ranks, blankRank(track.ranks[track.ranks.length - 1])] })} />
      </View>
    </View>
  );
}

function Editor({ draft, onClose, onSaved }: { draft: Draft | null; onClose: () => void; onSaved: (text: string) => void }) {
  const [d, setD] = useState<Draft | null>(draft);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => { setD(draft); setNotes((draft?.notes ?? []).join('\n')); setErr(null); setConfirmDel(false); }, [draft]);
  if (!d) return null;
  const setTrack = (i: number, tr: Track) => setD({ ...d, tracks: d.tracks.map((x, j) => (j === i ? tr : x)) });

  function problems() {
    if (!d!.name.trim()) return pt('rt_errName');
    for (const tr of d!.tracks) {
      if (!tr.name.trim()) return pt('rt_errTrack');
      for (const r of tr.ranks) {
        if (!r.name.trim()) return pt('rt_errRank', { track: tr.name });
        if (!isHex(r.color) || (r.stripe_color && !isHex(r.stripe_color))) return pt('rt_errColor', { rank: r.name });
      }
    }
    return null;
  }

  async function save() {
    const p = problems(); if (p) { setErr(p); return; }
    setBusy(true); setErr(null);
    const body = { name: d!.name.trim(), style: d!.style?.trim() || null, org: d!.org?.trim() || null, source: d!.source?.trim() || null,
      notes: notes.split('\n').map((x) => x.trim()).filter(Boolean), tracks: d!.tracks, active: d!.active };
    try {
      if (d!.key) await platformApi.saveRankTemplate(d!.key, body); else await platformApi.createRankTemplate(body);
      onSaved(pt('rt_saved'));
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  async function restore() {
    setBusy(true); setErr(null);
    try { await platformApi.restoreRankTemplate(d!.key!); onSaved(pt('rt_restored')); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!confirmDel) { setConfirmDel(true); return; }
    setBusy(true); setErr(null);
    try { await platformApi.deleteRankTemplate(d!.key!); onSaved(pt('rt_deleted')); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog visible onClose={onClose} title={d.key ? pt('rt_editTitle', { name: d.name }) : pt('rt_newTitle')} wide
      actions={<>
        {d.key && d.builtin ? <Button variant="ghost" icon="rotate-ccw" label={pt('rt_restore')} onPress={restore} disabled={busy} /> : null}
        {d.key && !d.builtin ? <Button variant="ghost" icon="trash-2" label={confirmDel ? pt('rt_confirmDelete') : pt('rt_delete')} onPress={remove} disabled={busy} /> : null}
        <Button variant="ghost" label={t('common.cancel')} onPress={onClose} />
        <Button label={pt('save')} icon="check" loading={busy} onPress={save} />
      </>}>
      <FormGrid>
        <Field label={`${pt('rt_name')} *`} value={d.name} onChangeText={(v) => setD({ ...d, name: v })} />
        <Field label={pt('rt_style')} value={d.style ?? ''} onChangeText={(v) => setD({ ...d, style: v })} />
        <Field label={pt('rt_org')} value={d.org ?? ''} onChangeText={(v) => setD({ ...d, org: v })} />
        <Field label={pt('rt_source')} value={d.source ?? ''} onChangeText={(v) => setD({ ...d, source: v })} />
      </FormGrid>
      <Field label={pt('rt_notes')} value={notes} onChangeText={setNotes} multiline numberOfLines={4} hint={pt('rt_notesHint')} style={{ minHeight: 96, paddingVertical: 10 }} />
      <SwitchRow label={pt('rt_active')} hint={pt('rt_activeHint')} value={d.active} onChange={(v) => setD({ ...d, active: v })} />
      {d.tracks.map((tr, i) => (
        <View key={i} style={{ gap: space.sm, borderWidth: 1, borderColor: palette.lineSoft, borderRadius: radius.md, padding: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Text variant="smallStrong" style={{ flex: 1 }}>{pt('rt_track', { n: i + 1 })}</Text>
            {d.tracks.length > 1 ? <IconButton size="sm" icon="trash-2" label={pt('rt_removeTrack')}
              onPress={() => setD({ ...d, tracks: d.tracks.filter((_, j) => j !== i) })} /> : null}
          </View>
          <FormGrid>
            <Field label={`${pt('rt_trackName')} *`} value={tr.name} onChangeText={(v) => setTrack(i, { ...tr, name: v })} />
            <Select label={pt('rt_display')} value={tr.display_style} onChange={(v) => setTrack(i, { ...tr, display_style: v ?? 'belt' })}
              options={[{ value: 'belt', label: pt('rt_displayBelt') }, { value: 'rank', label: pt('rt_displayRank') }]} />
            <Field label={pt('rt_minAge')} value={tr.min_age == null ? '' : String(tr.min_age)} keyboardType="number-pad" onChangeText={(v) => setTrack(i, { ...tr, min_age: numOrNull(v) })} />
            <Field label={pt('rt_maxAge')} value={tr.max_age == null ? '' : String(tr.max_age)} keyboardType="number-pad" onChangeText={(v) => setTrack(i, { ...tr, max_age: numOrNull(v) })} />
          </FormGrid>
          <ScrollView horizontal contentContainerStyle={{ paddingBottom: 6 }}>
            <RankRows track={tr} onChange={(x) => setTrack(i, x)} />
          </ScrollView>
        </View>
      ))}
      <View style={{ alignSelf: 'flex-start' }}>
        <Button size="sm" variant="secondary" icon="plus" label={pt('rt_addTrack')} onPress={() => setD({ ...d, tracks: [...d.tracks, blankTrack()] })} />
      </View>
      <Text variant="small" color={palette.ink2}>{pt('rt_rankHint')}</Text>
      {err ? <Notice tone="danger">{err}</Notice> : null}
    </Dialog>
  );
}

export function RankTemplatesTab() {
  const wide = useIsWide();
  const data = useApi(() => platformApi.rankTemplates(), []);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data.data ?? []).filter((x) => !s || `${x.name} ${x.style ?? ''} ${x.org ?? ''}`.toLowerCase().includes(s));
  }, [data.data, q]);

  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <Notice tone="danger">{errorMessage(data.error)}</Notice>;

  return (
    <View style={{ gap: space.md }}>
      <Text variant="small" color={palette.ink2}>{pt('rt_intro')}</Text>
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.sm, alignItems: wide ? 'center' : 'stretch' }}>
        <View style={{ flex: 1 }}><SearchField value={q} onChange={setQ} placeholder={pt('rt_search')} /></View>
        <Button icon="plus" label={pt('rt_new')}
          onPress={() => { setMsg(null); setEdit({ name: '', style: null, org: null, source: null, notes: [], tracks: [blankTrack()], active: true }); }} />
      </View>
      {msg ? <Notice tone="success">{msg}</Notice> : null}
      {!list.length ? <EmptyState icon="award" title={pt('rt_empty')} /> : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          {list.map((x) => (
            <Pressable key={x.key} accessibilityRole="button" accessibilityLabel={pt('rt_editTitle', { name: x.name })}
              onPress={() => { setMsg(null); setEdit({ ...x, active: x.active ?? true }); }}
              style={{ width: wide ? 320 : '100%' }}>
              <Card style={{ gap: 6, opacity: x.active === false ? 0.6 : 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{x.name}{x.style ? ` · ${x.style}` : ''}</Text>
                  <Icon name="edit-2" size={16} color={palette.ink2} />
                </View>
                {x.org ? <Text variant="small" color={palette.ink2} numberOfLines={1}>{x.org}</Text> : null}
                <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {x.tracks[0]?.ranks.slice(0, 8).map((r, i) => <Belt key={i} size="sm" color={r.color} stripeColor={r.stripe_color} />)}
                </View>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  <Badge label={pt('rt_count', { tracks: x.tracks.length, ranks: countRanks(x) })} />
                  <Badge label={x.builtin ? pt('rt_builtin') : pt('rt_custom')} tone={x.builtin ? 'neutral' : 'info'} />
                  {x.active === false ? <Badge label={pt('rt_inactive')} tone="warning" /> : null}
                  {x.notes.some((n) => n.includes('⚠️')) ? <Badge label={pt('rt_unverified')} tone="warning" /> : null}
                </View>
              </Card>
            </Pressable>
          ))}
        </View>
      )}
      <Editor draft={edit} onClose={() => setEdit(null)} onSaved={(text) => { setEdit(null); setMsg(text); data.reload(); }} />
    </View>
  );
}
