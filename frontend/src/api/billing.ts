/** Planes, descuentos, membresías, cargos y pagos */
import { api } from './client';

export type BillingType = 'recurring' | 'class_pack' | 'one_time' | 'trial';
export type IntervalUnit = 'week' | 'month' | 'year';

export type Plan = {
  id: number; name: string; description: string | null; billing_type: BillingType; interval_unit: IntervalUnit | null; interval_count: number | null;
  price: number; currency: string; signup_fee: number | null; sessions_per_week: number | null; total_sessions: number | null; validity_days: number | null;
  max_members: number; all_disciplines: number; visible_to_students: number; sort_order: number; active: number; active_memberships?: number; discipline_ids: number[];
};
export type PlanInput = Partial<Omit<Plan, 'id' | 'active_memberships' | 'all_disciplines' | 'visible_to_students' | 'active'>> & {
  all_disciplines?: boolean; visible_to_students?: boolean; active?: boolean; discipline_ids?: number[];
};

export type Discount = { id: number; name: string; type: 'percent' | 'fixed'; value: number; description: string | null; active: number; in_use: number };

export type MembershipStatus = 'pending' | 'active' | 'paused' | 'past_due' | 'cancelled' | 'expired';
export type MembershipRow = {
  id: number; plan_id: number; plan_name: string; billing_type: BillingType; status: MembershipStatus; start_date: string; end_date: string | null;
  current_period_end: string | null; next_billing_date: string | null; price: number; currency: string; discount_type: string | null; discount_value: number | null;
  sessions_remaining: number | null; auto_renew: number; cancel_at_period_end: number; payer_user_id: number; members: string | null; balance_due: number;
};
export type ChargeLite = { id: number; type: string; description: string; period_start: string | null; period_end: string | null; total: number; amount_paid: number; status: string; due_date: string };
export type MembershipDetail = {
  id: number; plan_id: number; plan_name: string; billing_type: BillingType; interval_unit: IntervalUnit | null; interval_count: number | null; max_members: number;
  payer_user_id: number; payer_name: string; status: MembershipStatus; start_date: string; end_date: string | null;
  current_period_start: string | null; current_period_end: string | null; next_billing_date: string | null;
  price: number; final_price: number; currency: string; discount_id: number | null; discount_type: 'none' | 'percent' | 'fixed' | null; discount_value: number | null; discount_reason: string | null;
  sessions_per_week: number | null; sessions_remaining: number | null; auto_renew: number; cancel_at_period_end: number;
  cancelled_at: string | null; cancel_reason: string | null; notes: string | null; created_at: string; balance_due: number;
  members: { user_id: number; first_name: string; last_name: string | null; photo_url: string | null }[];
  pauses: { id: number; start_date: string; end_date: string; reason: string | null }[];
  charges: ChargeLite[];
};
export type NewMembership = {
  plan_id: number; member_ids: number[]; payer_user_id?: number; start_date?: string; discount_id?: number | null;
  discount_type?: 'none' | 'percent' | 'fixed'; discount_value?: number; discount_reason?: string; price?: number;
  auto_renew?: boolean; charge_first_period?: boolean; charge_signup_fee?: boolean; first_due_date?: string; notes?: string;
};

export type ChargeRow = {
  id: number; user_id: number; user_name: string; membership_id: number | null; type: string; description: string;
  period_start: string | null; period_end: string | null; amount: number; discount_amount: number; total: number; amount_paid: number; balance: number;
  currency: string; due_date: string; status: string; voided_reason: string | null; created_at: string; member_names: string | null;
};
export type PaymentRow = {
  id: number; user_id: number; user_name: string; amount: number; currency: string; method: string; status: string; paid_at: string;
  reference: string | null; receipt_url: string | null; provider: string | null; provider_fee?: number | null; refunded_amount: number; notes: string | null; received_by_name: string | null;
};
export type MyAccount = {
  summary: { balance_due: number; overdue: number; next_due_date: string | null; credit: number };
  charges: ChargeRow[];
};
export type PaymentMethods = { paypal_enabled: number; accepts_cash: number; accepts_transfer: number; transfer_instructions: string | null };

type Page = { page?: number; page_size?: number };

export const billingApi = {
  plans: (includeInactive = false) => api.get<Plan[]>('/plans', includeInactive ? { include_inactive: true } : undefined),
  createPlan: (b: PlanInput) => api.post<Plan>('/plans', b),
  updatePlan: (id: number, b: PlanInput) => api.patch<Plan>(`/plans/${id}`, b),

  discounts: () => api.get<Discount[]>('/discounts'),
  createDiscount: (b: { name: string; type: 'percent' | 'fixed'; value: number; description?: string | null }) => api.post<Discount>('/discounts', b),
  updateDiscount: (id: number, b: Partial<{ name: string; type: 'percent' | 'fixed'; value: number; description: string | null; active: boolean }>) => api.patch(`/discounts/${id}`, b),

  memberships: (q: { status?: string; plan_id?: number; user_id?: number; expiring_days?: number; q?: string } & Page) =>
    api.getPage<MembershipRow[]>('/memberships', q),
  membership: (id: number) => api.get<MembershipDetail>(`/memberships/${id}`),
  myMemberships: (userId?: number) => api.get<MembershipDetail[]>('/memberships/mine', userId ? { user_id: userId } : undefined),
  createMembership: (b: NewMembership) => api.post<MembershipDetail>('/memberships', b),
  updateMembership: (id: number, b: Record<string, unknown>) => api.patch<MembershipDetail>(`/memberships/${id}`, b),
  setMembers: (id: number, member_ids: number[]) => api.put<MembershipDetail>(`/memberships/${id}/members`, { member_ids }),
  pause: (id: number, b: { start_date: string; end_date: string; reason?: string }) => api.post<MembershipDetail>(`/memberships/${id}/pauses`, b),
  cancel: (id: number, b: { immediate: boolean; reason?: string }) => api.post<MembershipDetail>(`/memberships/${id}/cancel`, b),
  resume: (id: number) => api.post<MembershipDetail>(`/memberships/${id}/resume`),
  runBilling: () => api.post<Record<string, number | string>>('/memberships/billing/run'),

  charges: (q: { status?: string; user_id?: number; type?: string; from?: string; to?: string; q?: string } & Page) => api.getPage<ChargeRow[]>('/charges', q),
  createCharge: (b: { user_id: number; type: string; description: string; amount: number; due_date?: string }) => api.post<ChargeRow>('/charges', b),
  voidCharge: (id: number, reason: string) => api.post(`/charges/${id}/void`, { reason }),
  myAccount: (userId?: number) => api.get<MyAccount>('/charges/mine', userId ? { user_id: userId } : undefined),

  payments: (q: { status?: string; user_id?: number; method?: string; from?: string; to?: string; q?: string } & Page) => api.getPage<PaymentRow[]>('/payments', q),
  myPayments: (userId?: number) => api.get<PaymentRow[]>('/payments/mine', { user_id: userId, page_size: 50 }),
  cancelPayment: (id: number, reason: string) => api.post(`/payments/${id}/cancel`, { reason }),

  paymentMethods: () => api.get<PaymentMethods>('/dojo/payment-methods'),
};

/** Precio con descuento (igual que el servidor) */
export function applyDiscount(price: number, type?: string | null, value?: number | null) {
  if (!type || type === 'none' || !value) return price;
  const d = type === 'percent' ? Math.min(price, (price * value) / 100) : Math.min(price, value);
  return Math.round((price - d) * 100) / 100;
}
