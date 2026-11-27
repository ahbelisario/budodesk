/** Panel de la plataforma (solo superadmin): dojos y respaldos */
import { Linking, Platform } from 'react-native';
import { api, request } from './client';
import { API_URL } from '../config';

export type DojoPlan = 'trial' | 'basic' | 'pro';
export type DojoStatus = 'trial' | 'active' | 'expired' | 'suspended' | 'cancelled';

export type PlatformDojo = {
  id: number; slug: string; name: string; short_name: string | null; logo_url: string | null; color_primary: string | null;
  plan: DojoPlan; status: DojoStatus; trial_ends_at: string | null; timezone: string; currency: string; language: 'es' | 'en';
  country_code: string; created_at: string; members_active: number; students_active: number; last_activity: string | null;
  owners: string | null; owner_emails: string | null; is_member: boolean;
  // Plan de BudoDesk: el que aplica (la prueba es como Pro), sus límites con las excepciones del dojo, y el uso
  effective_plan: 'basic' | 'pro'; plan_name: string; custom_limits: boolean; locations_active: number;
  limits: { students: number | null; locations: number | null; finance: boolean };
  limit_students: number | null; limit_locations: number | null; limit_finance: number | null;
};

/** Plan de BudoDesk (lo que el dojo paga): límites editables. max_* null = sin límite */
export type SaasPlan = { code: 'basic' | 'pro'; name: string; max_students: number | null; max_locations: number | null; finance: boolean; dojos: number | null };

export type NewDojo = {
  name: string; short_name?: string | null; slug: string; timezone: string; currency: string; language: 'es' | 'en';
  country_code: string; plan: DojoPlan; status: 'trial' | 'active'; trial_ends_at?: string | null;
  owner_email: string; owner_first_name: string; owner_last_name?: string | null;
  copy_from_dojo_id?: number | null; send_owner_email: boolean;
};

export type CreatedDojo = {
  dojo: PlatformDojo;
  owner: { id: number; created: boolean; email: string; email_sent: boolean; has_password: boolean };
  copied: { disciplines?: number; ranks?: number; plans?: number; discounts?: number };
};

export type BackupSettings = {
  timezone: string; backup_enabled: boolean; backup_frequency: 'daily' | 'weekly'; backup_hour: number; backup_weekday: number;
  backup_keep: number; s3_enabled: boolean; s3_endpoint: string | null; s3_region: string | null; s3_bucket: string | null;
  s3_prefix: string | null; s3_access_key: string | null; s3_force_path_style: boolean; s3_keep: number;
  s3_has_secret: boolean; encryption_available: boolean; next_run: string | null; updated_at: string;
};

export type Backup = {
  id: number; filename: string; trigger: 'auto' | 'manual'; status: 'running' | 'ok' | 'failed';
  size_bytes: number | null; rows_count: number | null; files_count: number | null; error: string | null;
  started_at: string; finished_at: string | null; local_deleted_at: string | null;
  s3_status: 'none' | 'uploading' | 'ok' | 'failed' | 'deleted'; s3_error: string | null;
  created_by_name: string | null; local_available: boolean; s3_available: boolean;
};

export type SettingsPatch = Partial<Omit<BackupSettings, 's3_has_secret' | 'encryption_available' | 'next_run' | 'updated_at'>> & { s3_secret?: string | null };

export type MonitorSettings = { alerts_emails: string[]; alerts_push: boolean; heartbeat_url: string | null; disk_alert_pct: number };
export type DiskInfo = { path: string; total?: number; free?: number; free_pct?: number | null; error?: string };
export type MonitorStatus = {
  version: string; started_at: string; open_alerts: number; last_sweep: string | null; smtp_configured: boolean;
  heartbeat: { at: string | null; ok: boolean | null; error: string | null };
  disks: { backups: DiskInfo; uploads: DiskInfo };
  last_backup: { finished_at: string | null; status: 'ok' | 'failed' } | null;
};
export type PlatformAlert = {
  id: number; kind: string; alert_key: string; severity: 'warning' | 'critical'; title: string; detail: string | null;
  url: string | null; count: number; first_at: string; last_at: string; notified_at: string | null; notify_error: string | null;
  resolved_at: string | null; resolved_by: number | null; resolved_by_name: string | null;
};

import type { RankTemplate } from './ranks';

type TemplateBody = Omit<RankTemplate, 'key' | 'builtin'>;

export const platformApi = {
  plans: () => api.get<SaasPlan[]>('/platform/plans'),
  rankTemplates: () => api.get<RankTemplate[]>('/platform/rank-templates'),
  createRankTemplate: (b: TemplateBody) => api.post<RankTemplate>('/platform/rank-templates', b),
  saveRankTemplate: (key: string, b: Partial<TemplateBody>) => api.put<RankTemplate>(`/platform/rank-templates/${key}`, b),
  deleteRankTemplate: (key: string) => api.del<{ deleted: boolean }>(`/platform/rank-templates/${key}`),
  restoreRankTemplate: (key: string) => api.post<RankTemplate>(`/platform/rank-templates/${key}/restore`, {}),
  savePlan: (code: string, b: { name?: string; max_students?: number | null; max_locations?: number | null; finance?: boolean }) =>
    api.put<SaasPlan>(`/platform/plans/${code}`, b),
  monitoring: (status: 'open' | 'resolved' | 'all' = 'all') =>
    api.get<{ settings: MonitorSettings; status: MonitorStatus; alerts: PlatformAlert[] }>('/platform/monitoring', { status }),
  saveMonitoring: (b: { alerts_emails?: string; alerts_push?: boolean; heartbeat_url?: string | null; disk_alert_pct?: number }) =>
    api.put<MonitorSettings>('/platform/monitoring/settings', b),
  testAlert: () => api.post<{ ok: boolean; error: string | null }>('/platform/monitoring/test', {}),
  resolveAlert: (id: number) => api.post<{ id: number }>(`/platform/monitoring/alerts/${id}/resolve`, {}),
  dojos: () => api.get<PlatformDojo[]>('/platform/dojos'),
  createDojo: (b: NewDojo) => api.post<CreatedDojo>('/platform/dojos', b),
  updateDojo: (id: number, b: Partial<Pick<PlatformDojo, 'name' | 'short_name' | 'plan' | 'status' | 'trial_ends_at' | 'limit_students' | 'limit_locations'>> & { limit_finance?: boolean | null }) =>
    api.patch<PlatformDojo>(`/platform/dojos/${id}`, b),
  /** Elimina el dojo y sus datos (solo cancelados). No se puede deshacer. */
  deleteDojo: (id: number, confirmSlug: string) =>
    request<{ id: number; slug: string; name: string; members: number; accounts_deleted: number }>(
      `/platform/dojos/${id}`, { method: 'DELETE', body: { confirm_slug: confirmSlug } }).then((r) => r.data),
  backups: () => api.get<{ settings: BackupSettings; backups: Backup[]; running: boolean }>('/platform/backups'),
  saveSettings: (b: SettingsPatch) => api.put<BackupSettings>('/platform/backups/settings', b),
  runNow: () => api.post<Backup>('/platform/backups/run'),
  testS3: (b: SettingsPatch) => api.post<{ ok: true }>('/platform/backups/s3/test', b),
  link: (id: number, source: 'local' | 's3') => api.post<{ url: string; expires_in: number }>(`/platform/backups/${id}/link`, { source }),
};

/** Pide un enlace temporal y abre la descarga */
export async function downloadBackup(id: number, source: 'local' | 's3') {
  const { url } = await platformApi.link(id, source);
  const full = `${API_URL}${url}`;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const a = document.createElement('a');
    a.href = full; a.rel = 'noopener'; a.download = '';
    document.body.appendChild(a); a.click(); a.remove();
  } else {
    await Linking.openURL(full);
  }
}

/** 1536 → "1.5 KB" */
export function fileSize(bytes: number | null | undefined) {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
