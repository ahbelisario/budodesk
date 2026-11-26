/** Plan de BudoDesk del dojo: límites y avisos */
export const planEs = {
  basic: 'Básico', pro: 'Pro',
  limit_students: 'El plan Básico permite hasta %{limit} alumnos activos y ya tienes %{current}.',
  limit_locations: 'El plan Básico incluye una sola sede.',
  limit_finance: 'Las finanzas (gastos e ingresos, por cobrar y sus gráficas) son parte del plan Pro.',
  limit_generic: 'Tu plan de BudoDesk no incluye esto.',
  howToUpgrade: 'Para cambiar a Pro, contacta a BudoDesk.',
  contact: 'Para cambiar a Pro escribe a %{email}.',
  studentsUsage: '%{current} de %{limit} alumnos activos (plan Básico)',
  studentsFull: 'Llegaste al máximo de %{limit} alumnos activos del plan Básico: no puedes dar de alta ni reactivar alumnos, y quien se registre solo quedará pendiente.',
  studentsOver: 'Tienes %{current} alumnos activos y el plan Básico permite %{limit}: conservas a todos, pero no puedes agregar más hasta bajar de %{limit}.',
  locationsHint: 'El plan Básico incluye una sola sede activa.',
  financeTitle: 'Finanzas: plan Pro',
};

export const planEn: typeof planEs = {
  basic: 'Basic', pro: 'Pro',
  limit_students: 'The Basic plan allows up to %{limit} active students and you already have %{current}.',
  limit_locations: 'The Basic plan includes a single location.',
  limit_finance: 'Finances (expenses and income, receivables and their charts) are part of the Pro plan.',
  limit_generic: "Your BudoDesk plan doesn't include this.",
  howToUpgrade: 'To upgrade to Pro, contact BudoDesk.',
  contact: 'To upgrade to Pro, write to %{email}.',
  studentsUsage: '%{current} of %{limit} active students (Basic plan)',
  studentsFull: "You've reached the Basic plan maximum of %{limit} active students: you can't add or reactivate students, and anyone who signs up will stay pending.",
  studentsOver: 'You have %{current} active students and the Basic plan allows %{limit}: you keep them all, but cannot add more until you are below %{limit}.',
  locationsHint: 'The Basic plan includes a single active location.',
  financeTitle: 'Finances: Pro plan',
};
