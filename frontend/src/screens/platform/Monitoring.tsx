/**
 * Plataforma → Monitoreo: a dónde llegan las alertas (correos configurables, push, latido,
 * umbral de disco), estado del servidor y alertas abiertas/resueltas.
 */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { platformApi, type DiskInfo, type MonitorSettings, type PlatformAlert } from '../../api/platform';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Badge, Button, Card, EmptyState, Field, Loading, Notice, Text } from '../../ui/primitives';
import { FilterChips, SwitchRow } from '../../ui/forms';
import { useIsWide } from '../../navigation/AppShell';
import { palette, space } from '../../theme/tokens';
import { t } from '../../i18n';
import { dateTimeShort } from '../../utils/format';

const pt = (k: string, o?: Record<string, unknown>) => t(`platform.${k}`, o);
type Msg = { tone: 'success' | 'danger' | 'warning' | 'info'; text: string } | null;

const size = (n?: number) => (n == null ? '—' : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`);

function SettingsCard({ s, onSaved }: { s: MonitorSettings; onSaved: (s: MonitorSettings) => void }) {
  const wide = useIsWide();
  const [emails, setEmails] = useState(s.alerts_emails.join(', '));
  const [push, setPush] = useState(s.alerts_push);
  const [hb, setHb] = useState(s.heartbeat_url ?? '');
  const [pct, setPct] = useState(String(s.disk_alert_pct));
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    setEmails(s.alerts_emails.join(', ')); setPush(s.alerts_push); setHb(s.heartbeat_url ?? ''); setPct(String(s.disk_alert_pct));
  }, [s]);
  const dirty = emails.trim() !== s.alerts_emails.join(', ') || push !== s.alerts_push
    || hb.trim() !== (s.heartbeat_url ?? '') || Number(pct) !== s.disk_alert_pct;

  async function save() {
    setBusy(true); setMsg(null);
    try {
      onSaved(await platformApi.saveMonitoring({
        alerts_emails: emails, alerts_push: push, heartbeat_url: hb.trim() || null, disk_alert_pct: Number(pct) || 10,
      }));
      setMsg({ tone: 'success', text: pt('saved') });
    } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(false); }
  }
  async function test() {
    setTesting(true); setMsg(null);
    try {
      const r = await platformApi.testAlert();
      setMsg(r.ok ? { tone: 'success', text: pt('mo_testOk') } : { tone: 'danger', text: pt('mo_testFail', { error: r.error }) });
    } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setTesting(false); }
  }

  return (
    <Card style={{ gap: space.md }}>
      <Text variant="bodyStrong">{pt('mo_where')}</Text>
      <Field label={pt('mo_emails')} value={emails} onChangeText={setEmails} autoCapitalize="none" autoCorrect={false}
        keyboardType="email-address" hint={pt('mo_emailsHint')} placeholder="alertas@budodesk.com" />
      <SwitchRow label={pt('mo_push')} hint={pt('mo_pushHint')} value={push} onChange={setPush} />
      <Field label={pt('mo_heartbeat')} value={hb} onChangeText={setHb} autoCapitalize="none" autoCorrect={false}
        keyboardType="url" placeholder="https://hc-ping.com/…" hint={pt('mo_heartbeatHint')} />
      <View style={{ width: wide ? 320 : '100%' }}>
        <Field label={pt('mo_disk')} value={pct} keyboardType="number-pad" onChangeText={(x) => setPct(x.replace(/\D/g, '').slice(0, 2))} />
      </View>
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.xs, justifyContent: 'flex-end' }}>
        <Button label={pt('mo_test')} variant="secondary" icon="send" loading={testing} disabled={dirty} onPress={test} fullWidth={!wide} />
        <Button label={pt('save')} variant="dark" icon="check" loading={busy} disabled={!dirty} onPress={save} fullWidth={!wide} />
      </View>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </Card>
  );
}

function DiskLine({ label, d, threshold }: { label: string; d: DiskInfo; threshold: number }) {
  const low = d.free_pct != null && d.free_pct < threshold;
  return (
    <Text variant="small" color={low ? palette.danger : palette.ink2}>
      {`${label}: ${d.error ? d.error : pt('mo_diskLine', { free: size(d.free), total: size(d.total), pct: d.free_pct })}`}
    </Text>
  );
}

function AlertCard({ a, onResolve }: { a: PlatformAlert; onResolve: () => void }) {
  const router = useRouter();
  const wide = useIsWide();
  const open = !a.resolved_at;
  return (
    <Card style={{ gap: space.xs, opacity: open ? 1 : 0.75 }}>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <Text variant="bodyStrong" style={{ flex: 1 }}>{a.title}</Text>
        {open
          ? <Badge label={pt(a.severity === 'critical' ? 'mo_critical' : 'mo_warning')} tone={a.severity === 'critical' ? 'danger' : 'warning'} />
          : <Badge label={pt('mo_resolvedTag')} tone="neutral" />}
      </View>
      {a.detail ? <Text variant="small">{a.detail}</Text> : null}
      <Text variant="small" color={palette.ink2}>
        {`${pt('mo_times', { count: a.count })} · ${pt('mo_since', { first: dateTimeShort(a.first_at), last: dateTimeShort(a.last_at) })}`}
      </Text>
      {a.notify_error ? <Text variant="small" color={palette.danger}>{pt('mo_notifyError', { error: a.notify_error })}</Text> : null}
      {a.resolved_at ? (
        <Text variant="small" color={palette.ink2}>
          {a.resolved_by ? pt('mo_resolvedBy', { when: dateTimeShort(a.resolved_at), by: a.resolved_by_name || '—' })
            : pt('mo_resolvedAuto', { when: dateTimeShort(a.resolved_at) })}
        </Text>
      ) : null}
      {open ? (
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.xs, justifyContent: 'flex-end' }}>
          {a.url ? <Button label={pt('mo_open')} variant="ghost" size="sm" icon="arrow-right" onPress={() => router.push(a.url as never)} fullWidth={!wide} /> : null}
          <Button label={pt('mo_resolve')} variant="secondary" size="sm" icon="check" onPress={onResolve} fullWidth={!wide} />
        </View>
      ) : null}
    </Card>
  );
}

export function MonitoringTab({ onOpenChange }: { onOpenChange: (n: number) => void }) {
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const data = useApi(() => platformApi.monitoring(filter), [filter]);
  const [msg, setMsg] = useState<Msg>(null);
  const d = data.data;
  useEffect(() => { if (d) onOpenChange(d.status.open_alerts); }, [d?.status.open_alerts]); // eslint-disable-line react-hooks/exhaustive-deps

  if (data.loading && !d) return <Loading />;
  if (data.error && !d) return <Notice tone="danger">{data.error}</Notice>;
  if (!d) return null;
  const st = d.status;

  async function resolve(id: number) {
    setMsg(null);
    try { await platformApi.resolveAlert(id); data.reload(); } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); }
  }

  return (
    <View style={{ gap: space.md }}>
      <SettingsCard s={d.settings} onSaved={(settings) => data.setData({ ...d, settings })} />

      <Card style={{ gap: 4 }}>
        <Text variant="bodyStrong">{pt('mo_status')}</Text>
        <Text variant="small" color={palette.ink2}>{pt('mo_version', { v: st.version, when: dateTimeShort(st.started_at) })}</Text>
        <Text variant="small" color={palette.ink2}>{st.last_sweep ? pt('mo_lastCheck', { when: dateTimeShort(st.last_sweep) }) : pt('mo_lastCheckNone')}</Text>
        <Text variant="small" color={st.heartbeat.ok === false ? palette.danger : palette.ink2}>
          {st.heartbeat.ok == null ? pt('mo_hbNone')
            : st.heartbeat.ok ? pt('mo_hbOk', { when: dateTimeShort(st.heartbeat.at!) }) : pt('mo_hbFail', { error: st.heartbeat.error })}
        </Text>
        <DiskLine label={pt('mo_disk_backups')} d={st.disks.backups} threshold={d.settings.disk_alert_pct} />
        <DiskLine label={pt('mo_disk_uploads')} d={st.disks.uploads} threshold={d.settings.disk_alert_pct} />
        <Text variant="small" color={palette.ink2} style={{ paddingTop: 4 }}>{pt('mo_watch')}</Text>
        {!st.smtp_configured ? <Notice tone="warning">{pt('mo_noSmtp')}</Notice> : null}
      </Card>

      <Text variant="bodyStrong">{pt('mo_alerts')}</Text>
      <FilterChips label={pt('mo_alerts')} value={filter} onChange={(k) => { setMsg(null); setFilter(k); }}
        options={(['open', 'resolved', 'all'] as const).map((k) => ({ key: k, label: pt(`mo_f_${k}`) }))} />
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {d.alerts.length === 0
        ? <Card><EmptyState icon="check-circle" title={filter === 'open' ? pt('mo_none') : pt('mo_noneAll')} /></Card>
        : d.alerts.map((a) => <AlertCard key={a.id} a={a} onResolve={() => resolve(a.id)} />)}
    </View>
  );
}
