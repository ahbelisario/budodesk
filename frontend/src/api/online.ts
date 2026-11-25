/** Pagos en línea (PayPal y Mercado Pago) */
import { Platform } from 'react-native';
import { api } from './client';

export type Provider = 'paypal' | 'mercadopago';
export type OnlineOption = { provider: Provider; name: string; test_mode: boolean; fee: { percent: number; fixed: number } };
export type CheckoutStatus = 'created' | 'pending' | 'completed' | 'failed' | 'cancelled' | 'expired';
export type Checkout = {
  id: number; provider: Provider; status: CheckoutStatus; subtotal: number; fee: number; total: number; currency: string;
  payment_id: number | null; error: string | null; test_mode: boolean;
};
export type CheckoutStart = {
  checkout_id: number; provider: Provider; redirect_url: string; subtotal: number; fee: number; total: number; currency: string; test_mode: boolean;
};

/** A dónde regresa el proveedor: el mismo sitio (web) o la app nativa */
export function returnBase() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return 'budodesk://';
}

export const onlineApi = {
  options: () => api.get<OnlineOption[]>('/online-payments/options'),
  checkout: (b: { provider: Provider; charge_ids: number[]; user_id?: number }) =>
    api.post<CheckoutStart>('/online-payments/checkout', { ...b, return_base: returnBase() }),
  get: (id: number) => api.get<Checkout>(`/online-payments/${id}`),
  confirm: (id: number, cancelled?: boolean) => api.post<Checkout>(`/online-payments/${id}/confirm`, cancelled ? { cancelled: true } : {}),
};

/** Misma fórmula que el servidor: al dojo le llega completo el subtotal */
export function feeFor(subtotal: number, fee: { percent: number; fixed: number }) {
  if (!fee.percent && !fee.fixed) return 0;
  const total = (subtotal + fee.fixed) / (1 - Math.min(fee.percent, 50) / 100);
  return Math.round((total - subtotal) * 100) / 100;
}
