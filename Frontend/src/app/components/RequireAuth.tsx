import { Navigate, Outlet } from 'react-router';
import { useAuth } from '../context/AuthContext';

export function RequireAuth() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--background)] text-[var(--muted-foreground)] text-sm">
        Memuat sesi...
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
