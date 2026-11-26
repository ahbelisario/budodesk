/** Perfil → Notificaciones: activar en este dispositivo, prueba, y cómo instalar la app */
import React, { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { Button, Notice, Text } from '../ui/primitives';
import { palette, space } from '../theme/tokens';
import { t } from '../i18n';
import { errorMessage } from '../utils/errors';
import { useIsWide } from '../navigation/AppShell';
import {
  canInstall, disablePush, enablePush, isIOS, isStandalone, onInstallChange, promptInstall, pushState, sendTestPush, type PushState,
} from './webPush';

const pt = (k: string, o?: Record<string, unknown>) => t(`push.${k}`, o);

export function DevicePushCard({ pushPrefOn, pushPrefLabel }: { pushPrefOn: boolean; pushPrefLabel: string }) {
  const wide = useIsWide();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState<'on' | 'off' | 'test' | 'install' | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null);
  const [installable, setInstallable] = useState(canInstall());

  useEffect(() => { pushState().then(setState).catch(() => setState('unsupported')); }, []);
  useEffect(() => onInstallChange(() => setInstallable(canInstall())), []);

  if (Platform.OS !== 'web' || state === null) return null; // en la app nativa llegará con las tiendas

  async function run(kind: 'on' | 'off' | 'test', fn: () => Promise<void>) {
    setBusy(kind); setMsg(null);
    try { await fn(); } catch (e) {
      // Errores del propio navegador (servicio de push caído, sin conexión…)
      const browserError = typeof DOMException !== 'undefined' && e instanceof DOMException;
      setMsg({ tone: 'danger', text: browserError ? `${pt('subscribeFailed')} (${e.name})` : errorMessage(e) });
    } finally { setBusy(null); }
  }
  const btnStyle = wide ? undefined : { alignSelf: 'stretch' as const };

  return (
    <View style={{ gap: space.sm, paddingBottom: space.sm }}>
      <Text variant="smallStrong">{pt('title')}</Text>

      {state === 'needs-install' ? (
        <Notice tone="info" title={pt('iosTitle')}>
          {`1. ${pt('ios1')}\n2. ${pt('ios2')}\n3. ${pt('ios3')}\n\n${pt('iosNote')}`}
        </Notice>
      ) : state === 'unsupported' ? (
        <Text variant="small" color={palette.ink2}>{pt('unsupported')}</Text>
      ) : state === 'denied' ? (
        <Notice tone="warning">{pt('denied')}</Notice>
      ) : state === 'on' ? (
        <>
          <Text variant="small" color={palette.ink2}>{pt('on')}</Text>
          {!pushPrefOn ? <Notice tone="warning">{pt('pushOffWarn', { label: pushPrefLabel })}</Notice> : null}
          <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.xs }}>
            <Button label={pt('test')} variant="secondary" size="sm" icon="bell" loading={busy === 'test'} style={btnStyle}
              onPress={() => run('test', async () => {
                const r = await sendTestPush();
                setMsg(r.sent > 0 ? { tone: 'success', text: pt('testSent') } : { tone: 'danger', text: r.lastError || pt('testNone') });
              })} />
            <Button label={pt('disable')} variant="ghost" size="sm" loading={busy === 'off'} style={btnStyle}
              onPress={() => run('off', async () => { await disablePush(); setState(await pushState()); })} />
          </View>
        </>
      ) : (
        <>
          <Text variant="small" color={palette.ink2}>{pt('off')}</Text>
          <Button label={pt('enable')} icon="bell" loading={busy === 'on'} style={wide ? { alignSelf: 'flex-start' } : btnStyle}
            onPress={() => run('on', async () => {
              const s = await enablePush();
              setState(s);
              if (s === 'on') {
                const r = await sendTestPush().catch(() => null);
                if (r && r.sent > 0) setMsg({ tone: 'success', text: pt('testSent') });
              }
            })} />
        </>
      )}

      {installable && !isStandalone() && !isIOS() ? (
        <View style={{ gap: space.xs, marginTop: space.xs }}>
          <Text variant="small" color={palette.ink2}>{pt('installHint')}</Text>
          <Button label={pt('install')} variant="secondary" size="sm" icon="download" loading={busy === 'install'}
            style={wide ? { alignSelf: 'flex-start' } : btnStyle}
            onPress={async () => { setBusy('install'); try { await promptInstall(); } finally { setBusy(null); setInstallable(canInstall()); } }} />
        </View>
      ) : null}

      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </View>
  );
}
