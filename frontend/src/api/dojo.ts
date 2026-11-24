/** Avisos, notificaciones y ajustes del dojo */
import { Platform } from 'react-native';
import { api } from './client';

export type Audience = 'all' | 'students' | 'guardians' | 'staff' | 'discipline';
export type AnnouncementFull = {
  id: number; title: string; body: string; audience: Audience; discipline_id: number | null; discipline: string | null;
  pinned: number; publish_at: string; expires_at: string | null; author: string | null;
};
export type AppNotification = {
  id: number; dojo_id: number | null; type: string; title: string; body: string | null;
  data: { screen?: string; session_id?: number; charge_id?: number; announcement_id?: number } | string | null; read_at: string | null; created_at: string;
};

export type DojoSettings = {
  id: number; slug: string; name: string; short_name: string | null; logo_url: string | null; phone: string | null; email: string | null; website: string | null;
  address_line1: string | null; address_line2: string | null; city: string | null; state: string | null; postal_code: string | null; country_code: string | null;
  facebook_url: string | null; instagram_url: string | null; tiktok_url: string | null; currency: string; timezone: string; language: 'es' | 'en';
  color_primary: string | null; color_secondary: string | null; color_accent: string | null;
  booking_cancel_hours: number; booking_window_days: number; require_membership_to_book: number;
  legal_name: string | null; tax_id: string | null; self_registration: 'closed' | 'approval' | 'open';
  privacy_policy: string | null; privacy_version: string | null; terms_conditions: string | null; plan: string; status: string; trial_ends_at: string | null;
};
export type PaymentSettings = {
  paypal_enabled: number; accepts_cash: number; accepts_transfer: number; transfer_instructions: string | null;
  late_fee_amount: number | null; late_fee_grace_days: number | null;
};
export type Location = { id: number; name: string; address: string | null; active: number };
export type AuditEntry = { id: number; action: string; entity: string; entity_id: string | null; before_data: unknown; after_data: unknown; created_at: string; user_name: string | null };

export const dojoApi = {
  announcements: (includeExpired = false) => api.get<AnnouncementFull[]>('/announcements', includeExpired ? { include_expired: true } : undefined),
  createAnnouncement: (b: { title: string; body: string; audience: Audience; discipline_id?: number | null; pinned?: boolean; send_push?: boolean; send_email?: boolean; expires_at?: string | null }) =>
    api.post<{ id: number; recipients: number }>('/announcements', b),
  updateAnnouncement: (id: number, b: { title?: string; body?: string; pinned?: boolean; expires_at?: string | null }) => api.patch(`/announcements/${id}`, b),
  deleteAnnouncement: (id: number) => api.del(`/announcements/${id}`),

  notifications: (beforeId?: number) => api.getPage<AppNotification[]>('/notifications', { limit: 30, before_id: beforeId }),
  markRead: (ids?: number[]) => api.post('/notifications/read', ids ? { ids } : { all: true }),

  settings: () => api.get<DojoSettings>('/dojo'),
  updateSettings: (b: Partial<Omit<DojoSettings, 'require_membership_to_book'>> & { require_membership_to_book?: boolean }) => api.patch<DojoSettings>('/dojo', b),
  paymentSettings: () => api.get<PaymentSettings>('/dojo/payment-settings'),
  updatePaymentSettings: (b: { accepts_cash?: boolean; accepts_transfer?: boolean; transfer_instructions?: string | null; late_fee_amount?: number | null; late_fee_grace_days?: number | null }) =>
    api.patch('/dojo/payment-settings', b),
  locations: () => api.get<Location[]>('/dojo/locations'),
  createLocation: (b: { name: string; address?: string | null }) => api.post<Location>('/dojo/locations', b),
  updateLocation: (id: number, b: { name?: string; address?: string | null; active?: boolean }) => api.patch(`/dojo/locations/${id}`, b),
  auditLog: (limit = 50) => api.get<AuditEntry[]>('/dojo/audit-log', { limit }),
};

/** Sube el logo del dojo y devuelve la URL */
export async function uploadLogo(uri: string, mime = 'image/png') {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append('file', blob, `logo.${blob.type.split('/')[1] || 'png'}`);
  } else {
    form.append('file', { uri, name: `logo.${mime.split('/')[1] || 'png'}`, type: mime } as unknown as Blob);
  }
  return api.upload<{ url: string }>('/uploads/logo', form);
}
