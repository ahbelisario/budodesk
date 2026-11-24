/** Horarios recurrentes (series): lista, alta, edición y terminar */
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { classesApi, WEEKDAYS, type Series } from '../../api/classes';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Screen } from '../../ui/Screen';
import { Badge, Button, Card, EmptyState, Icon, Loading, Notice, Text } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { SwitchRow } from '../../ui/forms';
import { palette, radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useIsWide } from '../../navigation/AppShell';
import { t, useLanguage } from '../../i18n';
import { dayShort, hm } from '../../utils/format';
import { SeriesDialog } from './ClassForms';
import { ageLabel, ct } from './bits';

type Msg = { tone: 'success' | 'danger'; text: string } | null;

function SeriesCard({ s, onEdit, onEnd }: { s: Series; onEdit: () => void; onEnd: () => void }) {
  const { accent } = useTheme();
  const ages = ageLabel(s.min_age, s.max_age);
  return (
    <Card style={{ gap: space.sm, borderLeftWidth: 4, borderLeftColor: s.color ?? accent, opacity: s.active ? 1 : 0.6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <Text variant="heading" numberOfLines={2}>{s.title}</Text>
          <Text variant="small" color={palette.ink2} numberOfLines={2}>{[s.discipline, s.instructor_name, s.location].filter(Boolean).join(' · ')}</Text>
        </View>
        {!s.active ? <Badge label={ct('ended')} /> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
        {WEEKDAYS.map((d) => {
          const on = s.days_of_week.includes(d);
          return (
            <View key={d} style={{ paddingHorizontal: 8, height: 26, borderRadius: radius.sm, justifyContent: 'center',
              backgroundColor: on ? palette.ink : 'transparent', borderWidth: 1, borderColor: on ? palette.ink : palette.lineSoft }}>
              <Text variant="caption" color={on ? '#FFFFFF' : palette.ink3}>{ct(`day_${d}`)}</Text>
            </View>
          );
        })}
      </View>
      <Text variant="bodyStrong">{hm(s.start_time)} – {hm(s.end_time)}</Text>
      <Text variant="small" color={palette.ink2}>
        {[s.capacity != null ? `${ct('capacity')}: ${s.capacity}` : ct('noLimit'), ages,
          s.ends_on ? ct('endsOn', { date: dayShort(s.ends_on) }) : ct('startsOn', { date: dayShort(s.starts_on) })].filter(Boolean).join(' · ')}
      </Text>
      {s.active ? (
        <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
          <Button label={t('members.edit')} size="sm" variant="secondary" icon="edit-2" onPress={onEdit} />
          <Button label={ct('endSeries')} size="sm" variant="ghost" onPress={onEnd} />
        </View>
      ) : null}
    </Card>
  );
}

export function SeriesManager() {
  useLanguage();
  const router = useRouter();
  const params = useLocalSearchParams<{ new?: string }>();
  const wide = useIsWide();
  const [showEnded, setShowEnded] = useState(false);
  const data = useApi(() => classesApi.series(showEnded), [showEnded]);
  const [editing, setEditing] = useState<Series | null>(null);
  const [open, setOpen] = useState(false);
  const [ending, setEnding] = useState<Series | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => { if (params.new) { setEditing(null); setOpen(true); } }, [params.new]);

  async function end() {
    if (!ending) return;
    setBusy(true); setMsg(null);
    try { const r = await classesApi.endSeries(ending.id); setMsg({ tone: 'success', text: ct('seriesEnded', { count: r.sessions_cancelled }) }); data.reload(); }
    catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(false); setEnding(null); }
  }

  const list = data.data ?? [];
  return (
    <Screen maxWidth={1200} onRefresh={data.reload}>
      <Pressable accessibilityRole="link" onPress={() => (router.canGoBack() ? router.back() : router.replace('/classes' as never))}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}>
        <Icon name="chevron-left" size={18} color={palette.ink2} /><Text variant="smallStrong" color={palette.ink2}>{ct('back')}</Text>
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' }}>
        <View style={{ gap: 4, flexShrink: 1 }}>
          <Text variant="title" accessibilityRole="header">{ct('seriesTitle')}</Text>
          <Text variant="small" color={palette.ink2} style={{ maxWidth: 640 }}>{ct('seriesIntro')}</Text>
        </View>
        <Button label={ct('newSeries')} icon="plus" onPress={() => { setEditing(null); setOpen(true); }} />
      </View>
      <View style={{ maxWidth: 320 }}><SwitchRow label={ct('showEnded')} value={showEnded} onChange={setShowEnded} /></View>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {data.error ? <Notice tone="danger">{data.error}</Notice> : null}

      {data.loading ? <Loading /> : list.length === 0 ? (
        <Card><EmptyState icon="repeat" title={ct('noSeries')} body={ct('noSeriesBody')}
          action={<Button label={ct('newSeries')} icon="plus" onPress={() => { setEditing(null); setOpen(true); }} />} /></Card>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
          {list.map((s) => (
            <View key={s.id} style={{ flexGrow: 1, flexBasis: wide ? 320 : '100%', maxWidth: wide ? 520 : undefined, minWidth: 0 }}>
              <SeriesCard s={s} onEdit={() => { setEditing(s); setOpen(true); }} onEnd={() => setEnding(s)} />
            </View>
          ))}
        </View>
      )}

      <SeriesDialog visible={open} series={editing} onClose={() => setOpen(false)}
        onSaved={(m) => { setOpen(false); setMsg({ tone: 'success', text: m }); data.reload(); }} />
      <Dialog visible={!!ending} title={ending ? ct('endSeriesTitle', { title: ending.title }) : ''} onClose={() => setEnding(null)}
        actions={<><Button label={t('common.cancel')} variant="ghost" onPress={() => setEnding(null)} /><Button label={ct('endSeries')} variant="danger" loading={busy} onPress={end} /></>}>
        <Text color={palette.ink2}>{ct('endSeriesBody')}</Text>
      </Dialog>
    </Screen>
  );
}
