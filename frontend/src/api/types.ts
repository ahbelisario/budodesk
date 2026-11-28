/** Tipos del API v2 (los que usa el frontend). Ver backend/API.md */

export type Role = 'owner' | 'admin' | 'instructor' | 'staff' | 'student' | 'guardian';
export type DisplayStyle = 'rank' | 'belt';

export type DojoSummary = {
  id: number;
  slug: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  color_primary: string | null;
  color_secondary: string | null;
  color_accent: string | null;
  roles: Role[];
  /** Superadmin dentro de un dojo del que no es miembro */
  support?: boolean;
  /** expired = terminó la prueba gratis: solo lectura */
  status?: 'trial' | 'active' | 'expired' | 'suspended' | 'cancelled';
  trial_ends_at?: string | null;
  timezone?: string;
};

export type User = {
  id: number;
  email: string | null;
  username: string | null;
  first_name: string;
  last_name: string | null;
  photo_url: string | null;
  language: 'es' | 'en' | null;
  theme: 'system' | 'light' | 'dark';
  is_superadmin: boolean;
  email_verified: boolean;
};

export type AuthPayload = {
  access_token: string;
  access_token_expires_at: string;
  refresh_token?: string;
  refresh_token_expires_at?: string;
  user?: User;
  dojo: DojoSummary | null;
  dojos?: DojoSummary[];
  /** "Ver como" (soporte): presente solo mientras se ve la cuenta de otra persona */
  impersonation?: { user_id: number; name: string; expires_at: string };
};

export type PublicDojo = {
  id: number;
  slug: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  color_primary: string | null;
  language: 'es' | 'en';
  self_registration: 'closed' | 'approval' | 'open';
  privacy_version: string | null;
};

export type Minor = {
  user_id: number;
  first_name: string;
  last_name: string | null;
  photo_url: string | null;
  date_of_birth: string | null;
  relationship: string;
  can_book: number;
  can_pay: number;
};

export type RankBadge = {
  discipline_id: number;
  discipline: string;
  rank_id: number;
  rank: string;
  color: string;
  stripe_color: string | null;
  stripes: number;
  level: number;
  since_date: string;
  next_exam_date: string | null;
  display_style: DisplayStyle;
};

export type Page<T> = { data: T[]; meta: { page: number; page_size: number; total: number; total_pages: number } };
