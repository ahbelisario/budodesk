/** Reportes y finanzas del dojo (gastos y otros ingresos) */
import { api } from './client';

export type FinKind = 'expense' | 'income';
export type FinCategory = { id: number; kind: FinKind; name: string; active: number; sort_order?: number; entries?: number };
export type FinEntry = {
  id: number; kind: FinKind; category_id: number; category: string; description: string | null; amount: number; currency: string;
  entry_date: string; method: 'cash' | 'transfer' | 'card' | 'other' | null; reference: string | null; notes: string | null; recurring_id: number | null;
};
export type FinEntryInput = {
  kind: FinKind; category_id: number; amount: number; entry_date: string;
  description?: string | null; method?: FinEntry['method']; reference?: string | null; notes?: string | null;
};
export type FinRecurring = {
  id: number; kind: FinKind; category_id: number; category: string; description: string | null; amount: number; currency: string;
  day_of_month: number; starts_on: string; ends_on: string | null; active: number; last_period: string | null;
};
export type FinRecurringInput = {
  kind: FinKind; category_id: number; amount: number; day_of_month: number; starts_on: string; ends_on?: string | null; description?: string | null; active?: boolean;
};

export type Tuition = { membership: number; exams: number; signup: number; other: number; credit: number; total: number };
export type FinanceMonth = {
  month: string; tuition: Tuition; methods: Record<string, number>;
  other_income: Record<string, number>; other_income_total: number; expenses: Record<string, number>; online_fees: number;
  expense_total: number; income_total: number; net: number; cumulative: number;
};
export type FinanceReport = {
  from: string; to: string; currency: string; months: FinanceMonth[];
  totals: Omit<FinanceMonth, 'month' | 'cumulative'>; categories: FinCategory[];
};
export type ReceivableRow = {
  user_id: number; name: string; charges: number; oldest_due: string;
  total: number; current: number; overdue: number; d1_30: number; d31_60: number; d61_90: number; d90: number;
};
export type Receivables = { today: string; currency: string; rows: ReceivableRow[]; totals: Omit<ReceivableRow, 'user_id' | 'name' | 'charges' | 'oldest_due'>; people: number };
export type MembersReport = {
  from: string; to: string;
  months: { month: string; joined: number; left: number; paid: number; unpaid: number }[];
  snapshot: { active: number; inactive: number; pending: number; minors: number; with_access: number };
};
export type AttendanceReport = {
  from: string; to: string;
  classes: { k: string; title: string; discipline: string | null; sessions: number; attended: number; no_show: number; avg: number }[];
  students: { user_id: number; name: string; attended: number; no_show: number; last_attended: string | null }[];
  totals: { sessions: number; attended: number; avg: number; students_without: number };
};
export type RanksReport = {
  from: string; to: string;
  exams: { id: number; title: string; exam_date: string; status: string; discipline: string; candidates: number; passed: number; failed: number; absent: number }[];
  promotions: { user_id: number; name: string; awarded_date: string; rank_name: string; discipline: string }[];
  distribution: { discipline: string; rank_id: number; rank_name: string; level: number; kind: string; members: number }[];
};

type Q = Record<string, string | number | undefined>;

export const reportsApi = {
  finance: (q: { from?: string; to?: string }) => api.get<FinanceReport>('/reports/finance', q as Q),
  receivables: () => api.get<Receivables>('/reports/receivables'),
  members: (q: { from?: string; to?: string }) => api.get<MembersReport>('/reports/members', q as Q),
  attendance: (q: { from?: string; to?: string }) => api.get<AttendanceReport>('/reports/attendance', q as Q),
  ranks: (q: { from?: string; to?: string }) => api.get<RanksReport>('/reports/ranks', q as Q),
};

export const financeApi = {
  categories: (kind?: FinKind) => api.get<FinCategory[]>('/finance/categories', kind ? { kind } : undefined),
  createCategory: (b: { kind: FinKind; name: string }) => api.post<{ id: number }>('/finance/categories', b),
  updateCategory: (id: number, b: { name?: string; active?: boolean; sort_order?: number }) => api.patch(`/finance/categories/${id}`, b),
  deleteCategory: (id: number) => api.del(`/finance/categories/${id}`),
  entries: (q: { from?: string; to?: string; kind?: FinKind; category_id?: number }) => api.getPage<FinEntry[]>('/finance/entries', q as Q),
  createEntry: (b: FinEntryInput) => api.post<{ id: number }>('/finance/entries', b),
  updateEntry: (id: number, b: Partial<FinEntryInput>) => api.patch(`/finance/entries/${id}`, b),
  deleteEntry: (id: number) => api.del(`/finance/entries/${id}`),
  recurring: () => api.get<FinRecurring[]>('/finance/recurring'),
  createRecurring: (b: FinRecurringInput) => api.post<{ id: number; created: number }>('/finance/recurring', b),
  updateRecurring: (id: number, b: Partial<FinRecurringInput>) => api.patch(`/finance/recurring/${id}`, b),
  deleteRecurring: (id: number) => api.del(`/finance/recurring/${id}`),
};
