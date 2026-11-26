/** Clases: horario (series), sesiones, reservas, pase de lista y código de llegada */
import { api } from './client';
import type { Session, SessionsMeta } from './home';

export type { Session, SessionsMeta };
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export type Series = {
  id: number; title: string; description: string | null; discipline_id: number | null; discipline: string | null;
  location_id: number | null; location: string | null; instructor_id: number | null; instructor_name: string | null;
  days_of_week: Weekday[]; start_time: string; end_time: string; starts_on: string; ends_on: string | null;
  capacity: number | null; min_age: number | null; max_age: number | null; color: string | null; active: number;
};
export type SeriesInput = {
  title: string; description?: string | null; discipline_id?: number | null; location_id?: number | null; instructor_id?: number | null;
  days_of_week: Weekday[]; start_time: string; end_time: string; starts_on: string; ends_on?: string | null;
  capacity?: number | null; min_age?: number | null; max_age?: number | null; color?: string | null;
};

export type RosterEntry = {
  booking_id: number; user_id: number; first_name: string; last_name: string | null; photo_url: string | null;
  status: 'booked' | 'waitlisted' | 'attended' | 'no_show' | 'late_cancel'; waitlist_position: number | null;
  checked_in_at: string | null; checkin_method: 'manual' | 'qr' | null; age: number | null; has_medical_notes: number;
  rank_name: string | null; rank_color: string | null;
};
export type SessionDetail = Omit<Session, 'my_booking' | 'my_waitlist_position' | 'starts_at' | 'ends_at' | 'is_past' | 'can_cancel_free' | 'spots_left'> & {
  is_modified: number; roster?: RosterEntry[]; checkin_code?: string | null;
};
export type Location = { id: number; name: string; address: string | null; active: number };
export type SessionInput = {
  title?: string; discipline_id?: number | null; location_id?: number | null; instructor_id?: number | null;
  session_date?: string; start_time?: string; end_time?: string; capacity?: number | null; notes?: string | null;
};

export type ListView = 'upcoming' | 'past' | 'all' | 'edited';
export type ListedSession = Omit<Session, 'my_booking' | 'my_waitlist_position' | 'starts_at' | 'ends_at' | 'can_cancel_free' | 'fits' | 'misfit_reason'> & {
  is_modified: number; edited_at: string | null;
};
export type ListMeta = { page: number; page_size: number; total: number; total_pages: number; today: string };

export const classesApi = {
  /** Listado para el personal, sin límite de fechas (sirve para encontrar una clase movida) */
  sessionsList: (q: { view: ListView; q?: string; discipline_id?: number; include_cancelled?: boolean; page?: number; page_size?: number }) =>
    api.getPage<ListedSession[]>('/classes/sessions/list', q).then((r) => ({ data: r.data, meta: r.meta as ListMeta })),
  sessions: (q: { from: string; to: string; user_id?: number; discipline_id?: number; instructor_id?: number; only_fit?: boolean; include_cancelled?: boolean }) =>
    api.getPage<Session[]>('/classes/sessions', q).then((r) => ({ data: r.data, meta: r.meta as SessionsMeta })),
  session: (id: number) => api.get<SessionDetail>(`/classes/sessions/${id}`),
  createSession: (b: SessionInput) => api.post<SessionDetail>('/classes/sessions', b),
  updateSession: (id: number, b: SessionInput) => api.patch<SessionDetail>(`/classes/sessions/${id}`, b),
  cancelSession: (id: number, reason?: string) => api.post<{ notified_users: number }>(`/classes/sessions/${id}/cancel`, reason ? { reason } : {}),
  restoreSession: (id: number) => api.post(`/classes/sessions/${id}/restore`),

  book: (id: number, userId: number, force = false) => api.post<{ status: 'booked' | 'waitlisted'; waitlist_position: number | null }>(`/classes/sessions/${id}/book`, { user_id: userId, force }),
  cancelBooking: (id: number, userId: number) => api.del<{ status: string }>(`/classes/sessions/${id}/book`, { user_id: userId }),
  attendance: (id: number, entries: { user_id: number; status: 'attended' | 'no_show' | 'booked' }[], complete = false) =>
    api.put<{ updated: number; walk_ins: number; marked_no_show: number }>(`/classes/sessions/${id}/attendance`, { entries, complete }),
  newCode: (id: number) => api.post<{ code: string }>(`/classes/sessions/${id}/checkin-code`),
  checkIn: (id: number, userId: number, code: string) => api.post(`/classes/sessions/${id}/checkin`, { user_id: userId, code }),

  series: (includeInactive = false) => api.get<Series[]>('/classes/series', includeInactive ? { include_inactive: true } : undefined),
  createSeries: (b: SeriesInput) => api.post<{ id: number; sessions_created: number }>('/classes/series', b),
  updateSeries: (id: number, b: Partial<SeriesInput>) => api.patch<{ sessions_updated: number; sessions_removed: number; sessions_created: number }>(`/classes/series/${id}`, b),
  endSeries: (id: number) => api.del<{ sessions_cancelled: number }>(`/classes/series/${id}`),

  locations: () => api.get<Location[]>('/dojo/locations'),
};

// ---- Fechas locales (AAAA-MM-DD) --------------------------------------------
const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDaysYmd = (s: string, n: number) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const mondayOf = (s: string) => { const d = parseYmd(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return ymd(d); };
export const todayYmd = () => ymd(new Date());
