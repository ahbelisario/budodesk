/**
 * Cliente HTTP del API v2.
 *
 * - Agrega el access token y lo renueva ANTES de que venza.
 * - Si el servidor responde 401 TOKEN_EXPIRED, renueva y reintenta una vez.
 * - La renovación es "single-flight": si varias peticiones la necesitan a la
 *   vez, todas esperan la MISMA llamada a /auth/refresh. (Dos renovaciones con
 *   el mismo refresh token se detectan como robo y cierran la sesión.)
 */
import { API_URL } from '../config';
import { tokenStore } from './tokenStore';
import type { AuthPayload } from './types';

export class ApiError extends Error {
  status: number;
  code: string;
  // Validación: lista de campos. Límite del plan (PLAN_LIMIT): { feature, limit, current }
  details?: { field: string; message: string }[] & { feature?: string; limit?: number; current?: number; plan_name?: string };
  constructor(status: number, code: string, message: string, details?: ApiError['details']) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  /** Mensaje del campo (para mostrar debajo de un input) */
  fieldError(field: string) {
    return this.details?.find((d) => d.field === field)?.message;
  }
}

type Listener = (auth: AuthPayload | null) => void;
let onAuthChange: Listener = () => {};
/** El SessionProvider se suscribe para saber cuándo cambian los tokens o se pierde la sesión */
export function setAuthListener(fn: Listener) { onAuthChange = fn; }

let refreshing: Promise<AuthPayload | null> | null = null;

async function doRefresh(): Promise<AuthPayload | null> {
  const refresh = await tokenStore.getRefresh();
  if (!refresh) return null;
  try {
    const res = await fetch(`${API_URL}/api/v2/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      // Solo un rechazo explícito borra la sesión; un fallo de red no
      if (res.status === 401 || res.status === 403) {
        await tokenStore.clear();
        onAuthChange(null);
      }
      return null;
    }
    const data = json.data as AuthPayload;
    await applyAuth(data);
    return data;
  } catch {
    return null; // sin red: se reintentará en la siguiente petición
  }
}

/** Guarda los tokens de un login/refresh y avisa a la sesión */
export async function applyAuth(data: AuthPayload) {
  tokenStore.setAccess(data.access_token, data.access_token_expires_at);
  if (data.refresh_token) await tokenStore.setRefresh(data.refresh_token);
  onAuthChange(data);
}

export function refreshSession(): Promise<AuthPayload | null> {
  if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
  return refreshing;
}

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  auth?: boolean;       // default true
  form?: FormData;      // subida de archivos
};

function buildUrl(path: string, query?: Options['query']) {
  const qs = query
    ? Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
    : '';
  return `${API_URL}/api/v2${path}${qs ? `?${qs}` : ''}`;
}

export async function request<T = unknown>(path: string, opts: Options = {}): Promise<{ data: T; meta?: any }> {
  const auth = opts.auth !== false;
  if (auth && tokenStore.accessExpiring()) await refreshSession();

  const send = () => {
    const headers: Record<string, string> = {};
    if (!opts.form) headers['Content-Type'] = 'application/json';
    const token = tokenStore.getAccess();
    if (auth && token) headers.Authorization = `Bearer ${token}`;
    return fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  };

  let res: Response;
  try {
    res = await send();
  } catch {
    throw new ApiError(0, 'NETWORK', 'No hay conexión con el servidor');
  }

  if (res.status === 401 && auth) {
    const json = await res.clone().json().catch(() => null);
    if (json?.code === 'TOKEN_EXPIRED' && (await refreshSession())) {
      res = await send();
    } else if (json?.code !== 'TOKEN_EXPIRED') {
      await tokenStore.clear();
      onAuthChange(null);
    }
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, json?.code ?? `HTTP_${res.status}`, json?.message ?? `Error ${res.status}`, json?.details);
  }
  return { data: json?.data as T, meta: json?.meta };
}

export const api = {
  get: <T>(path: string, query?: Options['query']) => request<T>(path, { query }).then((r) => r.data),
  getPage: <T>(path: string, query?: Options['query']) => request<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }).then((r) => r.data),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }).then((r) => r.data),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }).then((r) => r.data),
  del: <T>(path: string, query?: Options['query']) => request<T>(path, { method: 'DELETE', query }).then((r) => r.data),
  public: {
    get: <T>(path: string, query?: Options['query']) => request<T>(path, { query, auth: false }).then((r) => r.data),
    post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body, auth: false }).then((r) => r.data),
  },
  upload: <T>(path: string, form: FormData, query?: Options['query']) =>
    request<T>(path, { method: 'POST', form, query }).then((r) => r.data),
};
