import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export const CHANGE_PASSWORD_PATH = '/change-password';

// Signed-in pages. Someone still using a password the school office gave them
// (a new login or a reset) sees only the "Choose your own password" screen
// until they have picked one; the server refuses everything else meanwhile.
export default function ProtectedRoute() {
  const token = useAuthStore((s) => s.token);
  const mustChange = useAuthStore((s) => s.user?.mustChangePassword === true);
  const { pathname } = useLocation();
  if (!token) return <Navigate to="/login" replace />;
  if (mustChange && pathname !== CHANGE_PASSWORD_PATH) return <Navigate to={CHANGE_PASSWORD_PATH} replace />;
  return <Outlet />;
}
