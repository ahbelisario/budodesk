/** Progreso del alumno (o del hijo del tutor): grado, lo que falta, temario, exámenes e historial */
import React from 'react';
import { Linking, Pressable, View } from 'react-native';
import { ranksApi } from '../../api/ranks';
import type { DisciplineProgress, Requirement } from '../../api/members';
import { useSession } from '../../session/SessionProvider';
import { useApi } from '../../utils/useApi';
import { Screen } from '../../ui/Screen';
import { Badge, Belt, Card, Divider, EmptyState, Icon, Loading, Notice, ProgressBar, SectionHeader, Text } from '../../ui/primitives';
import { palette, space, fonts } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useIsWide } from '../../navigation/AppShell';
import { t, useLanguage } from '../../i18n';
import { dayLong, dayShort, hm, money, dayYear } from '../../utils/format';
import { ViewAs } from '../StudentHome';
import { CandidateBadge, rt } from './bits';

const REQ_TONE = { pending: 'neutral', in_progress: 'warning', approved: 'success' } as const;
const CATS = ['technique', 'kata', 'sparring', 'theory', 'conduct', 'other'];

function Meter({ label, value, pct, ok }: { label: string; value: string; pct: number; ok: boolean }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 140, gap: 6, minWidth: 0 }}>
      <Text variant="caption" color="rgba(255,255,255,0.7)">{label}</Text>
      <Text variant="bodyStrong" color="#FFFFFF">{value}</Text>
      <ProgressBar value={pct / 100} color={ok ? '#86EFAC' : '#FFFFFF'} track="rgba(255,255,255,0.2)" label={label} />
    </View>
  );
}

/** Qué tan cerca está (promedio de los requisitos que aplican), 0–100 */
function closeness(p: NonNullable<DisciplineProgress['progress']>, approved: number, total: number) {
  const parts = [p.months.need ? p.months.pct : null, p.classes.need ? p.classes.pct : null, total ? (approved / total) * 100 : null].filter((x): x is number => x != null);
  return parts.length ? parts.reduce((a, b) => a + Math.min(b, 100), 0) / parts.length : 0;
}

function DisciplineCard({ d }: { d: DisciplineProgress }) {
  const { accent } = useTheme();
  const p = d.progress;
  const total = d.requirements.filter((r) => r.mandatory).length;
  const approved = d.requirements.filter((r) => r.mandatory && r.status === 'approved').length;
  const groups = CATS.map((c) => ({ c, items: d.requirements.filter((r) => (r.category ?? 'other') === c) })).filter((g) => g.items.length);

  return (
    <View style={{ gap: space.md }}>
      {/* Tarjeta principal (tinta) */}
      <View style={{ backgroundColor: palette.ink, borderRadius: 16, padding: space.lg, gap: space.sm, borderTopWidth: 4, borderTopColor: d.discipline_color ?? accent }}>
        <Text variant="overline" color="rgba(255,255,255,0.7)">{d.discipline}{d.track && d.track !== 'General' ? ` · ${d.track}` : ''}</Text>
        <Text style={{ fontFamily: fonts.display, fontSize: 34, lineHeight: 40 }} color="#FFFFFF">{d.current.name}</Text>
        {d.display_style === 'belt' ? <Belt size="lg" color={d.current.color} stripeColor={d.current.stripe_color} stripes={d.current.stripes} onDark /> : null}
        <Text variant="small" color="rgba(255,255,255,0.7)">{t('members.since')} {dayYear(d.current.since_date)}{d.current.stripes ? ` · ${t('members.stripes')}: ${d.current.stripes}` : ''}</Text>
        {d.next && p ? (
          <>
            <Text variant="body" color="#FFFFFF" style={{ marginTop: space.xs }}>{t('members.nextRank', { rank: d.next.name })}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
              {p.months.need ? <Meter label={t('members.timeInRank')} value={t('members.ofMonths', { have: Math.min(p.months.have, p.months.need), need: p.months.need })} pct={p.months.pct} ok={p.months.ok} /> : null}
              {p.classes.need ? <Meter label={t('members.classesInRank')} value={t('members.ofClasses', { have: p.classes.have, need: p.classes.need })} pct={p.classes.pct} ok={p.classes.ok} /> : null}
              {total ? <Meter label={t('members.syllabus')} value={t('members.ofReqs', { have: approved, need: total })} pct={(approved / total) * 100} ok={approved === total} /> : null}
            </View>
            {p.eligible ? <Text variant="smallStrong" color="#86EFAC">{rt('readyForExam')}</Text>
              : closeness(p, approved, total) >= 70 ? <Text variant="smallStrong" color="rgba(255,255,255,0.85)">{rt('keepGoing')}</Text> : null}
            {d.next_exam_date ? <Text variant="small" color="rgba(255,255,255,0.85)">{t('members.nextExam')}: {dayLong(d.next_exam_date)}</Text> : null}
          </>
        ) : <Text variant="small" color="rgba(255,255,255,0.85)">{t('members.topRank')}</Text>}
      </View>

      {/* Temario del siguiente grado */}
      {d.next && d.requirements.length ? (
        <Card style={{ gap: space.sm }}>
          <SectionHeader title={`${t('members.syllabus')} · ${d.next.name}`} />
          {groups.map((g) => (
            <View key={g.c} style={{ gap: 2 }}>
              <Text variant="overline" color={palette.ink2}>{t(`members.cat_${g.c}`)}</Text>
              {g.items.map((r: Requirement, i) => (
                <View key={r.id}>
                  {i > 0 ? <Divider /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6 }}>
                    <Icon name={r.status === 'approved' ? 'check-circle' : r.status === 'in_progress' ? 'clock' : 'circle'} size={18}
                      color={r.status === 'approved' ? palette.success : r.status === 'in_progress' ? palette.warning : palette.ink3} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text>{r.name}{r.mandatory ? '' : ` · ${rt('optional')}`}</Text>
                      {r.description ? <Text variant="caption" color={palette.ink2}>{r.description}</Text> : null}
                      {r.video_url ? (
                        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(r.video_url!)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                          <Icon name="play-circle" size={14} color={palette.ink2} /><Text variant="caption" style={{ textDecorationLine: 'underline' }}>{rt('video')}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    <Badge label={t(`members.req_${r.status}`)} tone={REQ_TONE[r.status]} />
                  </View>
                </View>
              ))}
            </View>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

export function MyProgress() {
  useLanguage();
  const wide = useIsWide();
  const { user, actingUserId } = useSession();
  const uid = actingUserId ?? user?.id;
  const forOther = uid !== user?.id ? uid : undefined;
  const progress = useApi(() => ranksApi.myProgress(forOther), [uid]);
  const exams = useApi(() => ranksApi.myExams(forOther), [uid]);

  const discs = progress.data?.disciplines ?? [];
  const history = progress.data?.history ?? [];
  const myExams = exams.data ?? [];

  return (
    <Screen maxWidth={1000} onRefresh={() => { progress.reload(); exams.reload(); }}>
      <Text variant="title" accessibilityRole="header">{rt('progress')}</Text>
      <ViewAs />
      {progress.error ? <Notice tone="danger">{progress.error}</Notice> : null}
      {progress.loading ? <Loading /> : discs.length === 0 ? (
        <Card><EmptyState icon="award" title={rt('noProgress')} body={rt('noProgressBody')} /></Card>
      ) : (
        <View style={{ flexDirection: wide ? 'row' : 'column', flexWrap: wide ? 'wrap' : 'nowrap', gap: space.lg, alignItems: 'flex-start' }}>
          {discs.map((d) => <View key={d.discipline_id} style={{ flexGrow: 1, flexBasis: wide ? 420 : undefined, alignSelf: 'stretch', minWidth: 0 }}><DisciplineCard d={d} /></View>)}
        </View>
      )}

      {myExams.length ? (
        <Card>
          <SectionHeader title={rt('myExams')} />
          {myExams.map((e, i) => (
            <View key={e.candidate_id}>
              {i > 0 ? <Divider /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="bodyStrong" numberOfLines={2}>{e.title}</Text>
                  <Text variant="small" color={palette.ink2}>{rt('examOn', { date: dayShort(e.exam_date), rank: e.target_rank })}{e.start_time ? ` · ${hm(e.start_time)}` : ''}</Text>
                  {e.fee_status && ['pending', 'partial'].includes(e.fee_status) && e.fee ? <Text variant="caption" color={palette.warning}>{rt('feeDue', { amount: money(e.fee) })}</Text> : null}
                  {e.feedback ? <Text variant="caption" color={palette.ink2}>{e.feedback}</Text> : null}
                </View>
                <CandidateBadge status={e.status} />
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {history.length ? (
        <Card>
          <SectionHeader title={rt('history')} />
          {history.map((h, i) => (
            <View key={h.id}>
              {i > 0 ? <Divider /> : null}
              <View style={{ flexDirection: 'row', gap: space.md, paddingVertical: space.xs, alignItems: 'center' }}>
                <Text variant="small" color={palette.ink2} style={{ width: 92 }}>{dayYear(h.awarded_date)}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>{h.rank_name}{h.event_type === 'stripe' ? ` · ${t('members.stripes')} ${h.stripes}` : ''}</Text>
                  <Text variant="caption" color={palette.ink2} numberOfLines={1}>{[h.discipline, t(`members.ev_${h.event_type}`), h.score != null ? `${Number(h.score)}` : null].filter(Boolean).join(' · ')}</Text>
                </View>
              </View>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
