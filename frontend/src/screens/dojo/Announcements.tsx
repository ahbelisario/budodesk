/** Avisos del dojo: todos los leen; el personal publica, edita y elimina */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { dojoApi, type AnnouncementFull, type Audience } from '../../api/dojo';
import { ranksApi } from '../../api/ranks';
import { useSession } from '../../session/SessionProvider';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Screen } from '../../ui/Screen';
import { Badge, Button, Card, EmptyState, Field, Icon, Loading, Notice, Text } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { DateField, Select, SwitchRow } from '../../ui/forms';
import { palette, space } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useIsWide } from '../../navigation/AppShell';
import { t, useLanguage } from '../../i18n';
import { dateTimeShort, dayShort } from '../../utils/format';

export const dt = (k: string, o?: Record<string, unknown>) => t(`dojo.${k}`, o);
type Msg = { tone: 'success' | 'danger'; text: string } | null;
const AUDIENCES: Audience[] = ['all', 'students', 'guardians', 'staff', 'discipline'];

function AnnouncementDialog({ visible, item, onClose, onSaved }: { visible: boolean; item: AnnouncementFull | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const structure = useApi(() => ranksApi.structure(), []);
  const [title, setTitle] = useState(''); const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience>('all'); const [disc, setDisc] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false); const [push, setPush] = useState(true); const [email, setEmail] = useState(false);
  const [expires, setExpires] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setTitle(item?.title ?? ''); setBody(item?.body ?? ''); setAudience(item?.audience ?? 'all'); setDisc(item?.discipline_id ?? null);
    setPinned(!!item?.pinned); setPush(true); setEmail(false); setExpires(item?.expires_at ? item.expires_at.slice(0, 10) : null); setErr(null);
  }, [visible, item]);

  async function save() {
    if (!title.trim() || !body.trim() || (audience === 'discipline' && !disc)) { setErr(dt('required')); return; }
    setBusy(true); setErr(null);
    try {
      if (item) {
        await dojoApi.updateAnnouncement(item.id, { title: title.trim(), body: body.trim(), pinned, expires_at: expires });
        onSaved(dt('saved'));
      } else {
        const r = await dojoApi.createAnnouncement({ title: title.trim(), body: body.trim(), audience, discipline_id: audience === 'discipline' ? disc : null,
          pinned, send_push: push, send_email: email, expires_at: expires });
        onSaved(dt('published', { count: r.recipients }));
      }
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog visible={visible} onClose={onClose} title={item ? dt('editAnnouncement') : dt('newAnnouncement')} wide
      actions={<><Button label={t('common.cancel')} variant="ghost" onPress={onClose} /><Button label={item ? t('common.save') : dt('publish')} icon={item ? 'check' : 'send'} loading={busy} onPress={save} /></>}>
      {item ? <Notice tone="info">{dt('editNoResend')}</Notice> : null}
      <Field label={`${dt('a_title')} *`} value={title} onChangeText={setTitle} maxLength={150} />
      <Field label={`${dt('a_body')} *`} value={body} onChangeText={setBody} multiline style={{ minHeight: 120, paddingVertical: 12, textAlignVertical: 'top' }} />
      {!item ? (
        <>
          <Select label={dt('a_audience')} value={audience} onChange={(v) => v && setAudience(v)} options={AUDIENCES.map((a) => ({ value: a, label: dt(`aud_${a}`) }))} />
          {audience === 'discipline' ? <Select label={`${dt('a_discipline')} *`} value={disc} onChange={setDisc} options={(structure.data ?? []).map((d) => ({ value: d.id, label: d.name }))} /> : null}
        </>
      ) : null}
      <View style={{ maxWidth: 320 }}><DateField label={dt('a_expires')} value={expires} onChange={setExpires} hint={dt('a_expiresHint')} /></View>
      <SwitchRow label={dt('a_pinned')} hint={dt('a_pinnedHint')} value={pinned} onChange={setPinned} />
      {!item ? <SwitchRow label={dt('a_push')} hint={dt('a_pushHint')} value={push} onChange={setPush} /> : null}
      {!item ? <SwitchRow label={dt('a_email')} value={email} onChange={setEmail} /> : null}
      {err ? <Notice tone="danger">{err}</Notice> : null}
    </Dialog>
  );
}

export function Announcements() {
  useLanguage();
  const wide = useIsWide();
  const { accent } = useTheme();
  const { hasRole } = useSession();
  const canPost = hasRole('admin', 'staff', 'instructor');
  const canDelete = hasRole('admin', 'staff');
  const [showExpired, setShowExpired] = useState(false);
  const data = useApi(() => dojoApi.announcements(showExpired), [showExpired]);
  const [dlg, setDlg] = useState<{ open: boolean; item: AnnouncementFull | null }>({ open: false, item: null });
  const [del, setDel] = useState<AnnouncementFull | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const now = Date.now();

  async function remove() {
    if (!del) return;
    setBusy(true);
    try { await dojoApi.deleteAnnouncement(del.id); setDel(null); setMsg({ tone: 'success', text: dt('deleted') }); data.reload(); }
    catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); setDel(null); } finally { setBusy(false); }
  }

  return (
    <Screen maxWidth={860} onRefresh={data.reload}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' }}>
        <Text variant="title" accessibilityRole="header">{dt('announcements')}</Text>
        {canPost ? <Button label={dt('newAnnouncement')} icon="plus" onPress={() => setDlg({ open: true, item: null })} style={wide ? undefined : { alignSelf: 'stretch', flexGrow: 1 }} /> : null}
      </View>
      {canPost ? <View style={{ maxWidth: 320 }}><SwitchRow label={dt('showExpired')} value={showExpired} onChange={setShowExpired} /></View> : null}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {data.error ? <Notice tone="danger">{data.error}</Notice> : null}

      {data.loading ? <Loading /> : (data.data ?? []).length === 0 ? (
        <Card><EmptyState icon="bell" title={dt('noAnnouncements')} body={canPost ? dt('noAnnouncementsStaff') : dt('noAnnouncementsBody')} /></Card>
      ) : (data.data ?? []).map((a) => {
        const expired = !!a.expires_at && new Date(a.expires_at).getTime() <= now;
        return (
          <Card key={a.id} style={{ gap: space.sm, borderLeftWidth: 4, borderLeftColor: a.pinned ? accent : palette.lineSoft, opacity: expired ? 0.6 : 1 }}>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {a.pinned ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="bookmark" size={14} color={accent} /><Text variant="caption" color={accent}>{dt('pinned')}</Text></View> : null}
              {canPost ? <Badge label={a.audience === 'discipline' && a.discipline ? a.discipline : dt(`audShort_${a.audience}`)} /> : a.discipline ? <Badge label={a.discipline} /> : null}
              {expired ? <Badge label={dt('expired')} /> : a.expires_at ? <Text variant="caption" color={palette.ink2}>{dt('expires', { date: dayShort(a.expires_at.slice(0, 10)) })}</Text> : null}
            </View>
            <Text variant="heading">{a.title}</Text>
            <Text style={{ lineHeight: 22 }}>{a.body}</Text>
            <Text variant="caption" color={palette.ink2}>{[dateTimeShort(a.publish_at), a.author ? dt('by', { name: a.author }) : null].filter(Boolean).join(' · ')}</Text>
            {canPost ? (
              <View style={{ flexDirection: 'row', gap: space.xs }}>
                <Button label={t('members.edit')} size="sm" variant="secondary" icon="edit-2" onPress={() => setDlg({ open: true, item: a })} />
                {canDelete ? <Button label={dt('delete')} size="sm" variant="ghost" onPress={() => setDel(a)} /> : null}
              </View>
            ) : null}
          </Card>
        );
      })}

      <AnnouncementDialog visible={dlg.open} item={dlg.item} onClose={() => setDlg({ ...dlg, open: false })} onSaved={(m) => { setDlg({ ...dlg, open: false }); setMsg({ tone: 'success', text: m }); data.reload(); }} />
      <Dialog visible={!!del} title={del ? dt('deleteTitle', { title: del.title }) : ''} onClose={() => setDel(null)}
        actions={<><Button label={t('common.cancel')} variant="ghost" onPress={() => setDel(null)} /><Button label={dt('delete')} variant="danger" loading={busy} onPress={remove} /></>}>
        <Text color={palette.ink2}>{dt('deleteBody')}</Text>
      </Dialog>
    </Screen>
  );
}
