/** Grado: datos y temario (técnicas por categoría) */
import React, { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ranksApi, type ReqCategory, type RequirementDef } from '../../api/ranks';
import { useSession } from '../../session/SessionProvider';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Screen } from '../../ui/Screen';
import { Badge, Button, Card, Divider, EmptyState, Field, Icon, IconButton, Loading, Notice, Text } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { Select, SwitchRow } from '../../ui/forms';
import { palette, space } from '../../theme/tokens';
import { t, useLanguage } from '../../i18n';
import { money } from '../../utils/format';
import { RankDialog } from './Structure';
import { RankView, rt } from './bits';

type Msg = { tone: 'success' | 'danger'; text: string } | null;
const CATS: ReqCategory[] = ['technique', 'kata', 'sparring', 'theory', 'conduct', 'other'];

function ReqDialog({ visible, rankId, req, onClose, onSaved }: { visible: boolean; rankId: number; req: RequirementDef | null; onClose: () => void; onSaved: () => void }) {
  const [cat, setCat] = useState<ReqCategory>('technique');
  const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [video, setVideo] = useState(''); const [mandatory, setMandatory] = useState(true);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setCat(req?.category ?? 'technique'); setName(req?.name ?? ''); setDesc(req?.description ?? ''); setVideo(req?.video_url ?? '');
    setMandatory(req ? !!req.mandatory : true); setErr(null);
  }, [visible, req]);
  async function save() {
    if (!name.trim()) { setErr(rt('required')); return; }
    setBusy(true); setErr(null);
    try {
      const body = { category: cat, name: name.trim(), description: desc.trim() || null, video_url: video.trim() || null, mandatory };
      if (req) await ranksApi.updateRequirement(req.id, body); else await ranksApi.addRequirement(rankId, body);
      onSaved();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog visible={visible} onClose={onClose} title={req ? rt('editReq') : rt('newReq')}
      actions={<><Button label={t('common.cancel')} variant="ghost" onPress={onClose} /><Button label={t('common.save')} loading={busy} onPress={save} /></>}>
      <Select label={rt('r_category')} value={cat} onChange={(v) => v && setCat(v)} options={CATS.map((c) => ({ value: c, label: t(`members.cat_${c}`) }))} />
      <Field label={`${rt('r_name')} *`} value={name} onChangeText={setName} />
      <Field label={rt('r_description')} value={desc} onChangeText={setDesc} multiline style={{ minHeight: 64, paddingVertical: 12, textAlignVertical: 'top' }} />
      <Field label={rt('r_video')} value={video} onChangeText={setVideo} autoCapitalize="none" keyboardType="url" placeholder="https://" />
      <SwitchRow label={rt('r_mandatory')} hint={rt('r_mandatoryHint')} value={mandatory} onChange={setMandatory} />
      {err ? <Notice tone="danger">{err}</Notice> : null}
    </Dialog>
  );
}

export function RankSyllabus() {
  useLanguage();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { hasRole } = useSession();
  const admin = hasRole('admin');
  const canEditSyllabus = hasRole('admin', 'instructor');
  const rank = useApi(() => ranksApi.rank(Number(id)), [id]);
  const structure = useApi(() => ranksApi.structure(true), []);
  const [dlg, setDlg] = useState<{ open: boolean; req: RequirementDef | null }>({ open: false, req: null });
  const [rankOpen, setRankOpen] = useState(false);
  const [del, setDel] = useState<RequirementDef | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  if (rank.loading) return <Loading />;
  if (rank.error || !rank.data) return <Screen><Notice tone="danger">{rank.error ?? ''}</Notice></Screen>;
  const r = rank.data;
  const disc = structure.data?.find((d) => d.id === r.discipline_id);
  const track = disc?.tracks.find((x) => x.id === r.track_id) ?? null;
  const groups = CATS.map((c) => ({ c, items: r.requirements.filter((q) => q.category === c) })).filter((g) => g.items.length);
  const reload = () => { rank.reload(); structure.reload(); };

  async function remove() {
    if (!del) return;
    setBusy(true);
    try { await ranksApi.deleteRequirement(del.id); setDel(null); reload(); } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); setDel(null); } finally { setBusy(false); }
  }

  return (
    <Screen maxWidth={900}>
      <Pressable accessibilityRole="link" onPress={() => (router.canGoBack() ? router.back() : router.replace('/ranks?tab=structure' as never))}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}>
        <Icon name="chevron-left" size={18} color={palette.ink2} /><Text variant="smallStrong" color={palette.ink2}>{rt('backToRanks')}</Text>
      </Pressable>

      <Card style={{ gap: space.sm }}>
        <Text variant="overline" color={palette.ink2}>{[disc?.name, track?.name].filter(Boolean).join(' · ')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
          <Text variant="title" accessibilityRole="header" style={{ flexShrink: 1 }}>{r.name}</Text>
          {!r.active ? <Badge label={rt('inactive')} /> : null}
        </View>
        <RankView name={r.short_name ?? r.name} color={r.color} stripeColor={r.stripe_color} style={track?.display_style ?? 'rank'} />
        <Text variant="small" color={palette.ink2}>
          {[r.min_months ? rt('reqMonths', { count: r.min_months }) : null, r.min_classes ? rt('reqClasses', { count: r.min_classes }) : null,
            r.min_age ? rt('agesFrom', { min: r.min_age }) : null, r.requires_exam ? (r.exam_fee ? `${rt('exam')} ${money(r.exam_fee)}` : rt('exam')) : rt('noExam')].filter(Boolean).join(' · ')}
        </Text>
        {r.description ? <Text variant="small" color={palette.ink2}>{r.description}</Text> : null}
        {admin && track ? <Button label={rt('editRank')} size="sm" variant="secondary" icon="edit-2" onPress={() => setRankOpen(true)} style={{ alignSelf: 'flex-start' }} /> : null}
      </Card>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' }}>
        <View style={{ gap: 2, flexShrink: 1 }}>
          <Text variant="heading">{rt('syllabus')}</Text>
          <Text variant="small" color={palette.ink2}>{rt('syllabusIntro')}</Text>
        </View>
        {canEditSyllabus ? <Button label={rt('newReq')} icon="plus" onPress={() => setDlg({ open: true, req: null })} /> : null}
      </View>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      {groups.length === 0 ? <Card><EmptyState icon="list" title={rt('noReqs')} /></Card> : groups.map((g) => (
        <Card key={g.c} style={{ gap: 0 }}>
          <Text variant="overline" color={palette.ink2} style={{ marginBottom: space.xs }}>{t(`members.cat_${g.c}`)}</Text>
          {g.items.map((q, i) => (
            <View key={q.id}>
              {i > 0 ? <Divider /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs }}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Text variant="bodyStrong">{q.name}</Text>
                    {!q.mandatory ? <Badge label={rt('optional')} /> : null}
                  </View>
                  {q.description ? <Text variant="small" color={palette.ink2}>{q.description}</Text> : null}
                  {q.video_url ? (
                    <Pressable accessibilityRole="link" onPress={() => Linking.openURL(q.video_url!)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Icon name="play-circle" size={14} color={palette.ink2} /><Text variant="small" style={{ textDecorationLine: 'underline' }}>{rt('video')}</Text>
                    </Pressable>
                  ) : null}
                </View>
                {canEditSyllabus ? (
                  <View style={{ flexDirection: 'row' }}>
                    <IconButton icon="edit-2" label={rt('editReq')} size="sm" onPress={() => setDlg({ open: true, req: q })} />
                    <IconButton icon="trash-2" label={rt('deleteReq')} size="sm" onPress={() => setDel(q)} />
                  </View>
                ) : null}
              </View>
            </View>
          ))}
        </Card>
      ))}

      <ReqDialog visible={dlg.open} rankId={r.id} req={dlg.req} onClose={() => setDlg({ ...dlg, open: false })} onSaved={() => { setDlg({ ...dlg, open: false }); reload(); }} />
      <RankDialog visible={rankOpen} track={track} rank={r} onClose={() => setRankOpen(false)} onSaved={() => { setRankOpen(false); setMsg({ tone: 'success', text: rt('saved') }); reload(); }} />
      <Dialog visible={!!del} title={del ? rt('deleteReqTitle', { name: del.name }) : ''} onClose={() => setDel(null)}
        actions={<><Button label={t('common.cancel')} variant="ghost" onPress={() => setDel(null)} /><Button label={rt('deleteReq')} variant="danger" loading={busy} onPress={remove} /></>}>
        <Text color={palette.ink2}>{rt('deleteReqBody')}</Text>
      </Dialog>
    </Screen>
  );
}
