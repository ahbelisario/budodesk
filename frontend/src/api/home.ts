/** Datos de los inicios (admin y alumno). Formas según backend/API.md */
import { api } from './client';
import type { DisplayStyle } from './types';

// ---------------- Admin ----------------
export type DashboardSummary = {
  today: string;
  members: { active: number; pending_approval: number; new_this_month: number; left_this_month: number };
  memberships: { active: number; past_due: number; paused: number; expiring_7d: number };
  attendance_30d: { attended: number; no_show: number; rate: number | null };
  at_risk: number;
  at_risk_days: number;
  exam_eligible: number;
  today_classes: {
    id: number; title: string; start_time: string; end_time: string; capacity: number | null;
    booked_count: number; status: string; instructor_name: string | null; checked_in: number;
  }[];
  upcoming_exams: { id: number; title: string; exam_date: string; discipline: string; candidates: number }[];
  finance: null | {
    currency: string;
    revenue: { this_month: number; last_month: number; last_month_to_date: number };
    receivables: { open_balance: number; overdue_balance: number; overdue_people: number; due_next_7d: number };
  };
};

export type DashboardTodo = {
  pending_members: { user_id: number; first_name: string; last_name: string | null; email: string | null }[];
  overdue: { user_id: number; first_name: string; last_name: string | null; amount: number; oldest_due: string }[];
  expiring: { membership_id: number; plan: string; ends_on: string; members: string | null }[];
  at_risk: { user_id: number; first_name: string; last_name: string | null; last_attended: string | null }[];
  birthdays: { user_id: number; first_name: string; last_name: string | null; date_of_birth: string }[];
};

export type Revenue = { months: { month: string; total: number }[] };

export const adminHome = {
  summary: () => api.get<DashboardSummary>('/dashboard/summary'),
  todo: () => api.get<DashboardTodo>('/dashboard/todo'),
  revenue: (months = 6) => api.get<Revenue>('/dashboard/revenue', { months }),
};

// ---------------- Alumno ----------------
export type RankProgress = {
  discipline_id: number;
  discipline: string;
  track: string;
  display_style: DisplayStyle;
  current: { rank_id: number; name: string; color: string; stripe_color: string | null; level: number; kind: string; stripes: number; max_stripes: number; since_date: string };
  next: { rank_id: number; name: string; color: string; stripe_color: string | null; requires_exam: boolean } | null;
  next_exam_date: string | null;
  progress: null | {
    months: { have: number; need: number | null; pct: number; ok: boolean };
    classes: { have: number; need: number | null; pct: number; ok: boolean };
    requirements: { approved: number; total: number; pct: number; ok: boolean };
    eligible: boolean;
  };
};

export type Booking = {
  booking_id: number; status: 'booked' | 'waitlisted'; waitlist_position: number | null; checked_in_at: string | null;
  session_id: number; title: string; session_date: string; start_time: string; end_time: string;
  discipline: string | null; color: string | null; location: string | null; instructor_name: string | null;
};

export type Session = {
  id: number; title: string; discipline: string | null; color: string | null; location: string | null;
  instructor_name: string | null; session_date: string; start_time: string; end_time: string;
  capacity: number | null; booked_count: number; spots_left: number | null; waitlist_count: number; status: string;
  my_booking: string | null; my_waitlist_position: number | null;
  starts_at: string; ends_at: string; is_past: boolean; can_cancel_free: boolean;
};
export type SessionsMeta = { from: string; to: string; timezone: string; cancel_hours: number; booking_window_days: number };

export type MyMembership = {
  id: number; plan_name: string; billing_type: string; status: string;
  current_period_end: string | null; end_date: string | null; next_billing_date: string | null;
  final_price: number; currency: string; sessions_per_week: number | null; sessions_remaining: number | null;
  auto_renew: number; cancel_at_period_end: number; payer_user_id: number;
  members: { user_id: number; first_name: string; last_name: string | null }[];
};

export type MyCharges = {
  summary: { balance_due: number; overdue: number; next_due_date: string | null };
  charges: { id: number; description: string; balance: number; total: number; due_date: string; status: string; currency: string }[];
};

export type AttendanceStats = { attended_total: number; attended_30d: number; attendance_rate: number | null; streak_weeks: number; last_attended: string | null };
export type Announcement = { id: number; title: string; body: string; pinned: number; publish_at: string };
export type PaymentMethods = { paypal_enabled: number; accepts_cash: number; accepts_transfer: number; transfer_instructions: string | null };

export const studentHome = {
  progress: (userId: number) => api.get<{ disciplines: RankProgress[] }>('/progress/mine', { user_id: userId }),
  upcoming: (userId: number) => api.get<Booking[]>('/classes/bookings/mine', { user_id: userId, scope: 'upcoming', limit: 5 }),
  sessions: (userId: number, from: string, to: string) =>
    api.getPage<Session[]>('/classes/sessions', { user_id: userId, from, to }).then((r) => ({ data: r.data, meta: r.meta as SessionsMeta })),
  memberships: (userId: number) => api.get<MyMembership[]>('/memberships/mine', { user_id: userId }),
  charges: () => api.get<MyCharges>('/charges/mine', { status: 'open' }),
  attendance: (userId: number) => api.get<AttendanceStats>('/classes/attendance/stats', { user_id: userId }),
  announcements: () => api.get<Announcement[]>('/announcements'),
  paymentMethods: () => api.get<PaymentMethods>('/dojo/payment-methods'),
  unread: () => api.getPage<unknown[]>('/notifications', { unread: true, limit: 1 }).then((r) => Number(r.meta?.unread ?? 0)),
  book: (sessionId: number, userId: number) => api.post<{ status: 'booked' | 'waitlisted' }>(`/classes/sessions/${sessionId}/book`, { user_id: userId }),
  cancel: (sessionId: number, userId: number) => api.del(`/classes/sessions/${sessionId}/book`, { user_id: userId }),
  checkIn: (sessionId: number, userId: number, code: string) => api.post(`/classes/sessions/${sessionId}/checkin`, { user_id: userId, code }),
};
