import React from 'react';
import { useSession } from '@/session/SessionProvider';
import { AdminHome } from '@/screens/AdminHome';
import { StudentHome } from '@/screens/StudentHome';

/** Staff (owner, admin, staff, instructor) → tablero; alumnos y tutores → su inicio */
export default function Home() {
  const { isStaff } = useSession();
  return isStaff ? <AdminHome /> : <StudentHome />;
}
