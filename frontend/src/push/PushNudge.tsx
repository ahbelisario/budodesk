/** Recordatorio en el inicio del alumno: activar notificaciones (o instalar la app en iPhone). Se puede posponer. */
import React, { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Icon, Notice, Text } from '../ui/primitives';
import { palette, space } from '../theme/tokens';
import { t } from '../i18n';
import { useIsWide } from '../navigation/AppShell';
import { enablePush, pushState, sendTestPush, type PushState } from './webPush';

const KEY = 'budodesk.pushNudge';
const SNOOZE_DAYS = 30;
const pt = (k: string, o?: Record<string, unknown>) => t(`push.${k}`, o);

function snoozed() {
  try { const v = Number(window.localStorage.getItem(KEY) || 0); return Date.now() - v < SNOOZE_DAYS * 864e5; } catch { return false; }
}

export function PushNudge() {
  const router = useRouter();
  const wide = useIsWide();
  const [state, setState] = useState<PushState | null>(null);
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || snoozed()) return;
    pushState().then((s) => { setState(s); setHidden(!(s === 'off' || s === 'needs-install')); }).catch(() => {});
  }, []);

  if (hidden || !state) return null;
  const later = () => { try { window.localStorage.setItem(KEY, String(Date.now())); } catch { /* */ } setHidden(true); };

  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <Icon name="bell" size={20} color={palette.ink} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="bodyStrong">{state === 'needs-install' ? pt('iosTitle') : pt('nudgeTitle')}</Text>
          <Text variant="small" color={palette.ink2}>{pt('off')}</Text>
        </View>
      </View>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.xs }}>
        {state === 'needs-install' ? (
          <Button label={pt('howToInstall')} size="sm" onPress={() => router.push('/profile?tab=account' as never)} />
        ) : (
          <Button label={pt('enable')} size="sm" icon="bell" loading={busy} onPress={async () => {
            setBusy(true); setError(null);
            try {
              const s = await enablePush();
              if (s === 'on') { await sendTestPush().catch(() => null); setHidden(true); } else { setState(s); if (s === 'denied') setError(pt('denied')); }
            } catch { setError(pt('subscribeFailed')); } finally { setBusy(false); }
          }} />
        )}
        <Button label={pt('later')} size="sm" variant="ghost" onPress={later} />
      </View>
    </Card>
  );
}
