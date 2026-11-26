/** Registro público de dojos nuevos (sin sesión) y solicitudes (superadmin) */
import { api } from './client';
import type { PlatformDojo } from './platform';

export type SignupConfig = { enabled: boolean; trial_days: number; contact: string | null };
export type SlugStatus = { available: boolean; reason?: 'taken' | 'pending' | 'reserved' };

export type SignupForm = {
  dojo_name: string; slug: string; first_name: string; last_name?: string; email: string; phone?: string;
  city?: string; country_code: string; timezone: string; currency: string; language: 'es' | 'en';
  disciplines?: string; students_estimate?: number; message?: string; terms_accepted: boolean; website?: string;
};

export type SignupStatus = 'pending' | 'approved' | 'rejected';
export type Signup = {
  id: number; status: SignupStatus; dojo_name: string; slug: string; first_name: string; last_name: string | null;
  email: string; phone: string | null; city: string | null; country_code: string; timezone: string; currency: string;
  language: 'es' | 'en'; disciplines: string | null; students_estimate: number | null; message: string | null;
  dojo_id: number | null; dojo_slug: string | null; reviewed_at: string | null; reviewed_by_name: string | null;
  review_note: string | null; created_at: string; email_has_account: boolean; slug_status: SlugStatus | null;
};
export type SignupSettings = { signup_enabled: boolean; trial_days: number };

export const signupApi = {
  config: () => api.public.get<SignupConfig>('/signup/config'),
  slug: (slug: string) => api.public.get<SlugStatus>(`/signup/slug?slug=${encodeURIComponent(slug)}`),
  submit: (b: SignupForm) => api.public.post<{ id: number; status: 'pending' }>('/signup', b),

  list: (status: SignupStatus | 'all') =>
    api.get<{ settings: SignupSettings; pending: number; signups: Signup[] }>(`/platform/signups?status=${status}`),
  saveSettings: (b: Partial<SignupSettings>) => api.put<SignupSettings>('/platform/signups/settings', b),
  approve: (id: number, b: { name?: string; slug?: string; trial_days?: number; copy_from_dojo_id?: number | null; note?: string }) =>
    api.post<{ dojo: PlatformDojo; owner: { email: string; has_password: boolean }; email_sent: boolean; url: string }>(
      `/platform/signups/${id}/approve`, b),
  reject: (id: number, b: { reason?: string; notify: boolean }) =>
    api.post<{ id: number; email_sent: boolean }>(`/platform/signups/${id}/reject`, b),
};
