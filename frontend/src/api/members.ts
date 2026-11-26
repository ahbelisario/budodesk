/** Miembros, perfil, grados y datos relacionados para la ficha del alumno */
import { api, request } from './client';
import type { RankBadge, Role, DisplayStyle } from './types';
import { Platform } from 'react-native';

export type MemberStatus = 'pending' | 'active' | 'inactive' | 'suspended';
export type Gender = 'male' | 'female' | 'other' | 'undisclosed';

export type ProfileFields = {
  first_name: string;
  last_name: string | null;
  second_last_name: string | null;
  preferred_name: string | null;
  gender: Gender | null;
  date_of_birth: string | null;
  phone: string | null;
  photo_url: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country_code: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relation: string | null;
  blood_type: string | null;
  medical_notes: string | null;
};
export const PROFILE_KEYS = [
  'first_name', 'last_name', 'second_last_name', 'preferred_name', 'gender', 'date_of_birth', 'phone', 'photo_url',
  'address_line1', 'address_line2', 'city', 'state', 'postal_code', 'country_code',
  'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation', 'blood_type', 'medical_notes',
] as const satisfies readonly (keyof ProfileFields)[];

export type ActiveMembership = { id: number; plan: string; status: string; current_period_end: string | null; end_date: string | null } | null;

export type MemberRow = {
  id: number;
  email: string | null;
  can_login: boolean;
  first_name: string;
  last_name: string | null;
  preferred_name: string | null;
  photo_url: string | null;
  phone: string | null;
  date_of_birth: string | null;
  age: number | null;
  is_minor: boolean;
  member_number: string | null;
  status: MemberStatus;
  joined_at: string | null;
  roles: Role[];
  ranks: RankBadge[];
  active_membership: ActiveMembership;
  balance_due?: number;
  last_attendance: string | null;
};

export type Guardian = { user_id: number; relationship: string; is_primary: number; can_book: number; can_pay: number; first_name: string; last_name: string | null; email: string | null; phone: string | null };

export type MemberDetail = MemberRow & ProfileFields & {
  username: string | null;
  last_login_at: string | null;
  account_status: string;
  left_at: string | null;
  left_reason: string | null;
  source: string | null;
  notes?: string | null;
  guardians: Guardian[];
  minors: { user_id: number; relationship: string; first_name: string; last_name: string | null }[];
};

export type MyProfile = ProfileFields & {
  id: number; email: string | null; username: string | null; email_verified_at: string | null; created_at: string;
  language: 'es' | 'en' | null; theme: string | null;
  notify_email: number | null; notify_push: number | null; notify_class_reminders: number | null;
  notify_payment_reminders: number | null; notify_announcements: number | null;
};

// ---- Estructura de grados --------------------------------------------------
export type RankDef = {
  id: number; discipline_id: number; track_id: number; name: string; short_name: string | null; level: number; kind: string;
  color: string; stripe_color: string | null; max_stripes: number; min_months: number | null; min_classes: number | null;
  min_age: number | null; requires_exam: number; exam_fee: number | null; active: number;
};
export type TrackDef = { id: number; discipline_id: number; name: string; min_age: number | null; max_age: number | null; display_style: DisplayStyle; ranks: RankDef[] };
export type DisciplineDef = { id: number; name: string; style: string | null; color: string | null; active: number; tracks: TrackDef[] };

// ---- Progreso ----------------------------------------------------------------
export type Requirement = { id: number; category: string | null; name: string; description: string | null; video_url: string | null; mandatory: number; status: 'pending' | 'in_progress' | 'approved'; evaluated_at: string | null; notes: string | null };
export type ProgressMeter = { have: number; need: number | null; pct: number; ok: boolean };
export type DisciplineProgress = {
  discipline_id: number; discipline: string; discipline_color: string | null; track: string; display_style: DisplayStyle;
  current: { rank_id: number; name: string; color: string; stripe_color: string | null; level: number; kind: string; stripes: number; max_stripes: number; since_date: string };
  next: { rank_id: number; name: string; color: string; stripe_color: string | null; requires_exam: boolean; exam_fee: number | null } | null;
  next_exam_date: string | null;
  progress: { months: ProgressMeter; classes: ProgressMeter; requirements: { approved: number; total: number; pct: number; ok: boolean }; age?: { have: number | null; need: number | null; ok: boolean; unknown: boolean }; eligible: boolean } | null;
  requirements: Requirement[];
};
export type RankEvent = {
  id: number; discipline_id: number; discipline: string; rank_id: number; rank_name: string; color: string; stripe_color: string | null;
  stripes: number; event_type: 'initial' | 'promotion' | 'stripe' | 'demotion' | 'correction'; awarded_date: string;
  score: number | null; certificate_number: string | null; notes: string | null; awarded_by_name: string | null;
};

export type Charge = { id: number; type: string; description: string; period_start: string | null; period_end: string | null; total: number; amount_paid: number; balance: number; currency: string; due_date: string; status: string };
export type Payment = { id: number; amount: number; currency: string; method: string; status: string; paid_at: string; reference: string | null; notes: string | null; received_by_name: string | null };
export type Membership = {
  id: number; plan_name: string; status: string; start_date: string; end_date: string | null; current_period_start: string | null; current_period_end: string | null;
  next_billing_date: string | null; price: number; final_price: number; currency: string; discount_reason: string | null; payer_user_id: number; payer_name: string;
  balance_due: number; members: { user_id: number; first_name: string; last_name: string | null }[];
};
export type AttendanceStats = {
  attended_total: number; attended_30d: number; attended_90d: number; no_show_total: number; late_cancel_total: number;
  attendance_rate: number | null; last_attended: string | null; streak_weeks: number; by_discipline: { discipline_id: number; discipline: string; attended: number }[];
};
export type BookingRow = { booking_id: number; status: string; session_id: number; title: string; session_date: string; start_time: string; discipline: string | null; color: string | null; instructor_name: string | null };

export type ListQuery = { q?: string; role?: Role; status?: MemberStatus | 'all'; discipline_id?: number; sort?: 'name' | 'joined' | 'recent'; page?: number; page_size?: number };

export type CreateMember = Partial<ProfileFields> & {
  first_name: string; email?: string | null; roles: Role[]; status?: MemberStatus; member_number?: string | null; joined_at?: string | null; notes?: string | null;
  guardian_user_id?: number; guardian_relationship?: string; initial_ranks: { discipline_id: number; rank_id: number; since_date?: string }[]; send_access_email: boolean;
};

export const membersApi = {
  list: (q: ListQuery) => request<MemberRow[]>('/members', { query: q as Record<string, string | number | undefined> }),
  get: (id: number) => api.get<MemberDetail>(`/members/${id}`),
  create: (body: CreateMember) => api.post<MemberDetail>('/members', body),
  update: (id: number, body: Record<string, unknown>) => api.patch<MemberDetail>(`/members/${id}`, body),
  setRoles: (id: number, roles: Role[]) => api.put<{ roles: Role[] }>(`/members/${id}/roles`, { roles }),
  sendAccess: (id: number) => api.post(`/members/${id}/send-access`),
  deactivate: (id: number, reason?: string) => api.del(`/members/${id}`, { reason }),
  addGuardian: (id: number, body: { guardian_user_id: number; relationship?: string; can_book?: boolean; can_pay?: boolean }) => api.post<Guardian[]>(`/members/${id}/guardians`, body),
  removeGuardian: (id: number, guardianId: number) => api.del(`/members/${id}/guardians/${guardianId}`),

  structure: () => api.get<DisciplineDef[]>('/ranks/structure'),
  progress: (id: number) => api.get<{ disciplines: DisciplineProgress[]; history: RankEvent[] }>(`/progress/members/${id}`),
  promote: (body: { user_id: number; rank_id: number; stripes?: number; event_type?: string; awarded_date?: string; notes?: string | null; score?: number | null }) => api.post('/progress/promotions', body),
  evaluate: (userId: number, reqId: number, status: Requirement['status']) => api.put(`/progress/members/${userId}/requirements/${reqId}`, { status }),
  /** Corrección del historial de grados (dueño/admin). Devuelven el progreso actualizado. */
  editRankEvent: (id: number, b: { awarded_date?: string; certificate_number?: string | null; notes?: string | null }) =>
    api.patch<{ disciplines: DisciplineProgress[]; history: RankEvent[] }>(`/progress/history/${id}`, b),
  addPastRank: (b: { user_id: number; rank_id: number; awarded_date: string; stripes?: number; certificate_number?: string | null; notes?: string | null }) =>
    api.post<{ disciplines: DisciplineProgress[]; history: RankEvent[] }>('/progress/history', b),
  deleteRankEvent: (id: number) => api.del<{ disciplines: DisciplineProgress[]; history: RankEvent[] }>(`/progress/history/${id}`),
  setExamDate: (userId: number, disciplineId: number, date: string | null) => api.patch(`/progress/members/${userId}/disciplines/${disciplineId}`, { next_exam_date: date }),

  memberships: (id: number) => api.get<Membership[]>('/memberships/mine', { user_id: id }),
  charges: (id: number) => api.get<Charge[]>('/charges', { user_id: id, status: 'all', page_size: 50 }),
  payments: (id: number) => api.get<Payment[]>('/payments', { user_id: id, status: 'all', page_size: 50 }),
  registerPayment: (body: { user_id: number; amount: number; method: 'cash' | 'transfer' | 'card' | 'other'; reference?: string | null; notes?: string | null }) => api.post<Payment>('/payments', body),
  attendance: (id: number) => api.get<AttendanceStats>('/classes/attendance/stats', { user_id: id }),
  pastBookings: (id: number) => api.get<BookingRow[]>('/classes/bookings/mine', { user_id: id, scope: 'past', limit: 30 }),
};

export const meApi = {
  profile: () => api.get<MyProfile>('/me/profile'),
  update: (body: Partial<ProfileFields>) => api.patch<MyProfile>('/me/profile', body),
  settings: (body: Partial<Record<'notify_email' | 'notify_push' | 'notify_class_reminders' | 'notify_payment_reminders' | 'notify_announcements', boolean>>) => api.patch<MyProfile>('/me/settings', body),
  minorProfile: (id: number) => api.get<MyProfile>(`/me/minors/${id}/profile`),
  updateMinor: (id: number, body: Partial<ProfileFields>) => api.patch<MyProfile>(`/me/minors/${id}/profile`, body),
  sessions: () => api.get<{ id: number; user_agent: string | null; ip_address: string | null; created_at: string; last_used_at: string | null; current: number }[]>('/me/sessions'),
  logoutAll: () => api.post('/auth/logout-all'),
  joinDojo: (slug: string) => api.post<{ dojo_id: number; membership_status: string }>('/me/join-dojo', { dojo_slug: slug }),
};

/** Sube una foto (uri local o blob: en web) y devuelve la URL guardada */
export async function uploadAvatar(uri: string, userId?: number, mime = 'image/jpeg') {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append('file', blob, `avatar.${blob.type.split('/')[1] || 'jpg'}`);
  } else {
    form.append('file', { uri, name: `avatar.${mime.split('/')[1] || 'jpg'}`, type: mime } as unknown as Blob);
  }
  return api.upload<{ url: string }>('/uploads/avatar', form, userId ? { user_id: userId } : undefined);
}

/** Solo los campos de perfil que cambiaron, con '' → null */
export function profileDiff(before: Partial<ProfileFields>, after: Partial<ProfileFields>) {
  const out: Record<string, unknown> = {};
  for (const k of PROFILE_KEYS) {
    if (k === 'photo_url') continue;
    if (!(k in after)) continue;
    let v = after[k] as unknown;
    if (typeof v === 'string') { v = v.trim(); if (v === '' && k !== 'first_name') v = null; }
    const b = (before[k] ?? null) as unknown;
    if ((v ?? null) !== b) out[k] = v ?? null;
  }
  return out;
}
