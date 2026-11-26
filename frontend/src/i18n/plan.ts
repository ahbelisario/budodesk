/** Plan de BudoDesk del dojo: límites y avisos */
export const planEs = {
  basic: 'Básico', pro: 'Pro',
  limit_students: 'Tu plan (%{plan}) permite hasta %{limit} alumnos activos y ya tienes %{current}.',
  limit_locations: 'Tu plan (%{plan}) incluye hasta %{limit} sedes activas.',
  limit_finance: 'Las finanzas (gastos e ingresos, por cobrar y sus gráficas) no están incluidas en tu plan (%{plan}).',
  limit_generic: 'Tu plan de BudoDesk no incluye esto.',
  howToUpgrade: 'Para cambiar de plan, contacta a BudoDesk.',
  contact: 'Para cambiar de plan escribe a %{email}.',
  studentsUsage: '%{current} de %{limit} alumnos activos (plan %{plan})',
  studentsFull: 'Llegaste al máximo de %{limit} alumnos activos de tu plan (%{plan}): no puedes dar de alta ni reactivar alumnos, y quien se registre solo quedará pendiente.',
  studentsOver: 'Tienes %{current} alumnos activos y tu plan (%{plan}) permite %{limit}: conservas a todos, pero no puedes agregar más hasta bajar de %{limit}.',
  locationsHint: 'Tu plan (%{plan}) incluye hasta %{limit} sedes activas.',
  financeTitle: 'Finanzas: no incluidas en tu plan',
};

export const planEn: typeof planEs = {
  basic: 'Basic', pro: 'Pro',
  limit_students: 'Your plan (%{plan}) allows up to %{limit} active students and you already have %{current}.',
  limit_locations: 'Your plan (%{plan}) includes up to %{limit} active locations.',
  limit_finance: 'Finances (expenses and income, receivables and their charts) are not included in your plan (%{plan}).',
  limit_generic: "Your BudoDesk plan doesn't include this.",
  howToUpgrade: 'To change your plan, contact BudoDesk.',
  contact: 'To change your plan, write to %{email}.',
  studentsUsage: '%{current} of %{limit} active students (%{plan} plan)',
  studentsFull: "You've reached your plan's (%{plan}) maximum of %{limit} active students: you can't add or reactivate students, and anyone who signs up will stay pending.",
  studentsOver: 'You have %{current} active students and your plan (%{plan}) allows %{limit}: you keep them all, but cannot add more until you are below %{limit}.',
  locationsHint: 'Your plan (%{plan}) includes up to %{limit} active locations.',
  financeTitle: 'Finances: not included in your plan',
};
