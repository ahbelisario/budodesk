/** Detalle de examen: estado, candidatos, inscribir y capturar resultados */
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ranksApi, type Candidate, type CandidateStatus, type ExamStatus } from '../../api/ranks';
import { useSession } from '../../session/SessionProvider';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Screen } from '../../ui/Screen';
import { Avatar, Badge, Button, Card, Divider, Field, Icon, Loading, Notice, SectionHeader, Text } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { SwitchRow } from '../../ui/forms';
import { palette, space } from '../../theme/tokens';
import { useIsWide } from '../../navigation/AppShell';
import { t, useLanguage } from '../../i18n';
import { dayLong, fullName, hm } from '../../utils/format';
import { PersonPicker, type PickedPerson } from '../members/PersonPicker';
import { EligibleList, ExamDialog } from './Exams';
import { CandidateBadge, ExamStatusBadge, rt } from './bits';

type Msg = { tone: 'success' | 'danger' | 'info'; text: string } | null;

function ResultDialog({ examId, c, status, onClose, onSaved }: { examId: number; c: Candidate | null; status: CandidateStatus | null; onClose: () => void; onSaved: (m: string) => void }) {
  const [score, setScore] = useState(''); const [feedback, setFeedback] = useState(''); const [cert, setCert] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (c) { setScore(c.score != null ? String(c.score) : ''); setFeedback(c.feedback ?? ''); setCert(''); setErr(null); } }, [c]);
  async function save() {
    if (!c || !status) return;
    setBusy(true); setErr(null);
    try {
      const r = await ranksApi.setResult(examId, c.id, { status, score: score.trim() ? Number(score.replace(',', '.')) : null, feedback: feedback.trim() || null, certificate_number: cert.trim() || null });
      onSaved(r.promoted ? `${rt('resultSaved')} ${rt('promotedTo', { rank: r.rank })}` : rt('resultSaved'));
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog visible={!!c && !!status} onClose={onClose} title={c ? rt('resultTitle', { name: fullName(c) }) : ''}
      actions={<><Button label={t('common.cancel')} variant="ghost" onPress={onClose} /><Button label={rt('saveResult')} variant={status === 'passed' ? 'primary' : 'dark'} loading={busy} onPress={save} /></>}>
      {status ? <CandidateBadge status={status} /> : null}
      {status === 'passed' && c ? <Notice tone="info">{rt('resultHint', { rank: c.target_rank })}</Notice> : null}
      {status !== 'absent' ? <Field label={rt('score')} value={score} onChangeText={(v) => setScore(v.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" /> : null}
      <Field label={rt('feedback')} value={feedback} onChangeText={setFeedback} multiline style={{ minHeight: 64, paddingVertical: 12, textAlignVertical: 'top' }} />
      {status === 'passed' ? <Field label={rt('certificate')} value={cert} onChangeText={setCert} /> : null}
      {err ? <Notice tone="danger">{err}</Notice> : null}
    </Dialog>
  );
}

export function ExamDetail() {
  useLanguage();
  const router = useRouter();
  const wide = useIsWide();
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const { hasRole } = useSession();
  const canManage = hasRole('admin', 'instructor');
  const data = useApi(() => ranksApi.exam(Number(id)), [id]);
  const [msg, setMsg] = useState<Msg>(created ? { tone: 'success', text: rt('examCreated') } : null);
  const [result, setResult] = useState<{ c: Candidate; status: CandidateStatus } | null>(null);
  const [removing, setRemoving] = useState<Candidate | null>(null);
  const [edit, setEdit] = useState(false);
  const [adding, setAdding] = useState(false);
  const [other, setOther] = useState<PickedPerson | null>(null);
  const [chargeFee, setChargeFee] = useState(true);
  const [busy, setBusy] = useState(false);

  if (data.loading) return <Loading />;
  if (data.error || !data.data) return <Screen><Notice tone="danger">{data.error ?? ''}</Notice></Screen>;
  const e = data.data;
  const closed = ['completed', 'cancelled'].includes(e.status);

  async function setStatus(s: ExamStatus) {
    setBusy(true); setMsg(null);
    try { data.setData(await ranksApi.updateExam(e.id, { status: s })); } catch (x) { setMsg({ tone: 'danger', text: errorMessage(x) }); } finally { setBusy(false); }
  }
  async function enroll(ids: number[]) {
    setMsg(null);
    try {
      const r = await ranksApi.addCandidates(e.id, ids, chargeFee);
      setAdding(false); setOther(null);
      setMsg({ tone: r.skipped.length ? 'info' : 'success', text: rt('added', { count: r.added.length }) + (r.skipped.length ? ` ${rt('skipped', { list: r.skipped.map((s) => s.reason).join('; ') })}` : '') });
      data.reload();
    } catch (x) { setMsg({ tone: 'danger', text: errorMessage(x) }); }
  }
  async function remove() {
    if (!removing) return;
    setBusy(true);
    try { await ranksApi.removeCandidate(e.id, removing.id); setRemoving(null); data.reload(); }
    catch (x) { setMsg({ tone: 'danger', text: errorMessage(x) }); setRemoving(null); } finally { setBusy(false); }
  }

  return (
    <Screen maxWidth={1000}>
      <Pressable accessibilityRole="link" onPress={() => (router.canGoBack() ? router.back() : router.replace('/ranks' as never))}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}>
        <Icon name="chevron-left" size={18} color={palette.ink2} /><Text variant="smallStrong" color={palette.ink2}>{rt('backToExams')}</Text>
      </Pressable>

      <Card style={{ gap: space.sm }}>
        <Text variant="overline" color={palette.ink2}>{e.discipline}</Text>
        <Text variant="title" accessibilityRole="header">{e.title}</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}><ExamStatusBadge status={e.status} /></View>
        <Text>{dayLong(e.exam_date)}{e.start_time ? ` · ${hm(e.start_time)}` : ''}</Text>
        {e.examiner_name ? <Text variant="small" color={palette.ink2}>{rt('e_examiner')}: {e.examiner_name}</Text> : null}
        {e.registration_deadline ? <Text variant="small" color={palette.ink2}>{rt('e_deadline')}: {dayLong(e.registration_deadline)}</Text> : null}
        {e.notes ? <Text variant="small" color={palette.ink2}>{e.notes}</Text> : null}
        {canManage ? (
          <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap', marginTop: space.xs }}>
            {!closed ? <Button label={t('members.edit')} size="sm" variant="secondary" icon="edit-2" onPress={() => setEdit(true)} /> : null}
            {e.status === 'open' ? <Button label={rt('closeEntries')} size="sm" variant="secondary" loading={busy} onPress={() => setStatus('closed')} /> : null}
            {e.status === 'planned' || e.status === 'closed' ? <Button label={rt('openEntries')} size="sm" variant="secondary" loading={busy} onPress={() => setStatus('open')} /> : null}
            {!closed ? <Button label={rt('complete')} size="sm" variant="dark" icon="check" loading={busy} onPress={() => setStatus('completed')} /> : null}
            {!closed && e.candidates.every((c) => c.status !== 'passed') ? <Button label={rt('cancelExam')} size="sm" variant="ghost" onPress={() => setStatus('cancelled')} /> : null}
          </View>
        ) : null}
      </Card>

      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      <Card style={{ gap: space.sm }}>
        <SectionHeader title={rt('candidates', { count: e.candidates.length })}
          action={wide && canManage && !closed ? <Button label={rt('addCandidates')} size="sm" icon="user-plus" onPress={() => setAdding(true)} /> : undefined} />
        {!wide && canManage && !closed ? <Button label={rt('addCandidates')} icon="user-plus" onPress={() => setAdding(true)} /> : null}
        {e.candidates.length === 0 ? <Text color={palette.ink2}>{rt('noCandidates')}</Text> : e.candidates.map((c, i) => {
          const name = fullName(c);
          const decided = c.status !== 'registered';
          return (
            <View key={c.id}>
              {i > 0 ? <Divider /> : null}
              <View style={{ flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : 'stretch', gap: space.sm, paddingVertical: space.sm }}>
                <Pressable accessibilityRole="link" onPress={() => router.push(`/members/${c.user_id}?tab=ranks` as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flex: 1, minWidth: 0 }}>
                  <Avatar name={name} photoUrl={c.photo_url} size={40} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>{name}</Text>
                    <Text variant="small" color={palette.ink2} numberOfLines={1}>{c.from_rank ?? '—'} → <Text variant="smallStrong">{c.target_rank}</Text></Text>
                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <CandidateBadge status={c.status} />
                      {c.fee_status ? <Badge label={rt(`fee_${c.fee_status}`)} tone={c.fee_status === 'paid' ? 'success' : c.fee_status === 'void' ? 'neutral' : 'warning'} /> : null}
                      {c.score != null ? <Text variant="caption" color={palette.ink2}>{Number(c.score)}</Text> : null}
                    </View>
                    {c.feedback ? <Text variant="caption" color={palette.ink2}>{c.feedback}</Text> : null}
                  </View>
                </Pressable>
                {canManage && c.status !== 'passed' && e.status !== 'cancelled' ? (
                  <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap', justifyContent: wide ? 'flex-end' : 'flex-start' }}>
                    <Button label={rt('pass')} size="sm" icon="check" onPress={() => setResult({ c, status: 'passed' })} />
                    <Button label={rt('fail')} size="sm" variant="secondary" onPress={() => setResult({ c, status: 'failed' })} />
                    <Button label={rt('absent')} size="sm" variant="ghost" onPress={() => setResult({ c, status: 'absent' })} />
                    {!decided ? <Button label={rt('removeCandidate')} size="sm" variant="ghost" onPress={() => setRemoving(c)} /> : null}
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </Card>

      <ResultDialog examId={e.id} c={result?.c ?? null} status={result?.status ?? null} onClose={() => setResult(null)}
        onSaved={(m) => { setResult(null); setMsg({ tone: 'success', text: m }); data.reload(); }} />
      <ExamDialog visible={edit} exam={e} onClose={() => setEdit(false)} onSaved={(x) => { setEdit(false); data.setData(x); }} />
      <Dialog visible={!!removing} title={removing ? rt('removeTitle', { name: fullName(removing) }) : ''} onClose={() => setRemoving(null)}
        actions={<><Button label={t('common.cancel')} variant="ghost" onPress={() => setRemoving(null)} /><Button label={rt('removeCandidate')} variant="danger" loading={busy} onPress={remove} /></>}>
        <Text color={palette.ink2}>{rt('removeBody')}</Text>
      </Dialog>
      <Dialog visible={adding} title={rt('addCandidates')} onClose={() => setAdding(false)} wide
        actions={<Button label={t('common.close')} variant="ghost" onPress={() => setAdding(false)} />}>
        <Text variant="small" color={palette.ink2}>{rt('addCandidatesHint')}</Text>
        <SwitchRow label={rt('chargeFee')} value={chargeFee} onChange={setChargeFee} />
        <EligibleList disciplineId={e.discipline_id} exclude={e.candidates.map((c) => c.user_id)} onEnroll={(ids) => enroll(ids)} />
        <Divider />
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <View style={{ flexGrow: 1, flexBasis: 240 }}>
            <PersonPicker label={t('billing.person')} value={other} onChange={setOther} exclude={e.candidates.map((c) => c.user_id)} />
          </View>
          <Button label={rt('enroll')} variant="secondary" disabled={!other} onPress={() => other && enroll([other.id])} />
        </View>
      </Dialog>
    </Screen>
  );
}
