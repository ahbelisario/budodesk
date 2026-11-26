import type { Role } from '../api/types';
import type { IconName } from '../ui/primitives';

export type NavItem = {
  key: string;
  href: string;
  label: string;          // llave i18n
  short?: string;         // etiqueta corta para pestañas
  icon: IconName;
  roles?: Role[];         // si se omite: cualquiera
  staffOnly?: boolean;
  studentOnly?: boolean;  // vistas de alumno/tutor
  superadminOnly?: boolean; // panel de la plataforma
};

/** Menú completo. Cada rol ve lo que le corresponde. */
export const NAV: NavItem[] = [
  { key: 'home', href: '/home', label: 'nav.home', icon: 'home' },
  { key: 'members', href: '/members', label: 'nav.members', icon: 'users', roles: ['owner', 'admin', 'staff', 'instructor'] },
  { key: 'classes', href: '/classes', label: 'nav.schedule', short: 'nav.classes', icon: 'calendar' },
  { key: 'ranks', href: '/ranks', label: 'nav.ranks', icon: 'award', roles: ['owner', 'admin', 'instructor'] },
  { key: 'memberships', href: '/memberships', label: 'nav.memberships', icon: 'credit-card', roles: ['owner', 'admin', 'staff'] },
  { key: 'billing', href: '/billing', label: 'nav.billing', icon: 'dollar-sign', roles: ['owner', 'admin', 'staff'] },
  { key: 'announcements', href: '/announcements', label: 'nav.announcements', icon: 'bell' },
  { key: 'progress', href: '/progress', label: 'nav.progress', icon: 'trending-up', studentOnly: true },
  { key: 'payments', href: '/payments', label: 'nav.payments', icon: 'credit-card', studentOnly: true },
  { key: 'reports', href: '/reports', label: 'nav.reports', icon: 'bar-chart-2', roles: ['owner', 'admin', 'staff', 'instructor'] },
  { key: 'settings', href: '/settings', label: 'nav.settings', icon: 'settings', roles: ['owner', 'admin'] },
  { key: 'platform', href: '/platform', label: 'nav.platform', icon: 'server', superadminOnly: true },
  { key: 'profile', href: '/profile', label: 'nav.profile', icon: 'user' },
];

/** Pestañas inferiores en celular (máx. 5); el resto vive en "Más" */
const STAFF_TABS = ['home', 'members', 'classes', 'billing'];
const STUDENT_TABS = ['home', 'classes', 'progress', 'payments', 'profile'];

export function navFor(roles: Role[], isSuperadmin = false) {
  const staff = roles.some((r) => ['owner', 'admin', 'staff', 'instructor'].includes(r));
  const visible = NAV.filter((n) => {
    if (n.superadminOnly) return isSuperadmin;
    if (n.studentOnly) return !staff || roles.includes('student') || roles.includes('guardian');
    if (n.roles) return n.roles.some((r) => roles.includes(r));
    return true;
  });
  // El staff que también entrena ve sus vistas de alumno en "Más", no en el menú principal
  const main = staff ? visible.filter((n) => !n.studentOnly && n.key !== 'profile') : visible.filter((n) => n.key !== 'announcements');
  const tabKeys = staff ? STAFF_TABS : STUDENT_TABS;
  const tabs = tabKeys.map((k) => visible.find((n) => n.key === k)).filter(Boolean) as NavItem[];
  const more = visible.filter((n) => !tabKeys.includes(n.key));
  return { staff, main, tabs, more, all: visible };
}
