/** Bandeja de notificaciones: tocar una la marca como leída y abre la pantalla relacionada */
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { dojoApi, type AppNotification } from '../../api/dojo';
import { errorMessage } from '../../utils/errors';
import { Screen } from '../../ui/Screen';
import { Button, Card, Divider, EmptyState, Icon, Loading, Notice, Text } from '../../ui/primitives';
import { palette, space } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useLanguage } from '../../i18n';
import { dateTimeShort } from '../../utils/format';
import { dt } from './Announcements';

const ICONS: Record<string, React.ComponentProps<typeof Icon>['name']> = {
  announcement: 'bell', class_cancelled: 'x-circle', waitlist_promoted: 'check-circle', rank_promoted: 'award',
  payment_due: 'dollar-sign', payment_overdue: 'alert-circle',
};

function when(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return dt('justNow');
  if (mins < 60) return dt('minutesAgo', { count: mins });
  if (mins < 24 * 60) return dt('hoursAgo', { count: Math.round(mins / 60) });
  return dateTimeShort(iso);
}

/** A dónde lleva cada notificación */
function target(n: AppNotification): string | null {
  const d = typeof n.data === 'string' ? (() => { try { return JSON.parse(n.data as string); } catch { return null; } })() : n.data;
  switch (d?.screen) {
    case 'schedule': return d.session_id ? `/classes/${d.session_id}` : '/classes';
    case 'payments': return '/payments';
    case 'progress': return '/progress';
    case 'announcements': return '/announcements';
    default: return null;
  }
}

export function Notifications() {
  useLanguage();
  const router = useRouter();
  const { accent } = useTheme();
  const [rows, setRows] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load(beforeId?: number) {
    if (beforeId) setMore(true); else setLoading(true);
    setErr(null);
    try {
      const r = await dojoApi.notifications(beforeId);
      setRows((prev) => (beforeId ? [...prev, ...r.data] : r.data));
      setUnread(Number((r.meta as { unread?: number } | undefined)?.unread ?? 0));
      setHasMore(r.data.length === 30);
    } catch (e) { setErr(errorMessage(e)); } finally { setLoading(false); setMore(false); }
  }
  useEffect(() => { load(); }, []);

  async function open(n: AppNotification) {
    if (!n.read_at) {
      setRows((all) => all.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      setUnread((u) => Math.max(0, u - 1));
      dojoApi.markRead([n.id]).catch(() => {});
    }
    const to = target(n);
    if (to) router.push(to as never);
  }
  async function readAll() {
    setRows((all) => all.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
    setUnread(0);
    try { await dojoApi.markRead(); } catch (e) { setErr(errorMessage(e)); }
  }

  return (
    <Screen maxWidth={760} onRefresh={() => load()}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' }}>
        <View style={{ gap: 2 }}>
          <Text variant="title" accessibilityRole="header">{dt('notifications')}</Text>
          {unread ? <Text variant="small" color={palette.ink2}>{dt('unread', { count: unread })}</Text> : null}
        </View>
        {unread ? <Button label={dt('markAllRead')} size="sm" variant="secondary" icon="check" onPress={readAll} /> : null}
      </View>
      {err ? <Notice tone="danger">{err}</Notice> : null}
      {loading ? <Loading /> : rows.length === 0 ? (
        <Card><EmptyState icon="bell" title={dt('noNotifications')} body={dt('noNotificationsBody')} /></Card>
      ) : (
        <Card padding={0} style={{ overflow: 'hidden' }}>
          {rows.map((n, i) => {
            const isUnread = !n.read_at;
            return (
              <View key={n.id}>
                {i > 0 ? <Divider /> : null}
                <Pressable accessibilityRole="button" accessibilityLabel={`${n.title}${isUnread ? ' (sin leer)' : ''}`} onPress={() => open(n)}
                  style={({ pressed }) => ({ flexDirection: 'row', gap: space.md, padding: space.md, backgroundColor: pressed ? palette.paper : isUnread ? '#FBF8F2' : 'transparent' })}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.sunken }}>
                    <Icon name={ICONS[n.type] ?? 'bell'} size={18} color={palette.ink2} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text variant={isUnread ? 'bodyStrong' : 'body'}>{n.title}</Text>
                    {n.body ? <Text variant="small" color={palette.ink2} numberOfLines={3}>{n.body}</Text> : null}
                    <Text variant="caption" color={palette.ink3}>{when(n.created_at)}</Text>
                  </View>
                  {isUnread ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: accent, marginTop: 6 }} /> : null}
                </Pressable>
              </View>
            );
          })}
        </Card>
      )}
      {hasMore ? <Button label={dt('loadMore')} variant="secondary" loading={more} onPress={() => load(rows[rows.length - 1]?.id)} style={{ alignSelf: 'center' }} /> : null}
    </Screen>
  );
}
