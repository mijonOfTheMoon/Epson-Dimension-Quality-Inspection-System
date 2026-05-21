import { Outlet, NavLink, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  LayoutDashboard, History, AlertTriangle, LogOut,
  Menu, Settings, Video, ChevronUp, Moon, Sun,
} from 'lucide-react';
import { useState } from 'react';
import Logo from '../../assets/Logo.png';
import type { UserRole } from '../types/api';

const roleLabels: Record<string, string> = {
  operator: 'Operator QC',
  qc: 'Quality Control',
  supervisor: 'Supervisor',
  engineering: 'Engineering',
  admin: 'Admin Sistem',
  vendor: 'Vendor',
};

export function Layout() {
  const { user, logout, hasRole } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleLogout = async () => { await logout(); navigate('/login', { replace: true }); };

  const navItems: { to: string; icon: typeof LayoutDashboard; label: string; roles: UserRole[] }[] = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['operator', 'qc', 'supervisor', 'engineering', 'admin'] },
    { to: '/live-tracking', icon: Video, label: 'Live Tracking', roles: ['operator', 'qc', 'supervisor', 'engineering', 'admin'] },
    { to: '/history', icon: History, label: 'Riwayat Inspeksi', roles: ['operator', 'qc', 'supervisor', 'engineering', 'admin'] },
    { to: '/quality-tracking', icon: AlertTriangle, label: 'Quality Tracking', roles: ['engineering', 'supervisor', 'vendor', 'admin'] },
    { to: '/settings', icon: Settings, label: 'Settings', roles: ['qc', 'supervisor', 'engineering', 'admin'] },
  ];

  const visibleItems = navItems.filter((item) => item.roles.some((r) => hasRole(r)));

  return (
    <div className="flex h-screen bg-[var(--background)]">
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-[#0f172a] text-white transform transition-transform lg:translate-x-0 lg:static ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
          <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center overflow-hidden">
            <img src={Logo} className="w-full h-full object-cover" />
          </div>
          <div>
            <div className="text-sm tracking-wide" style={{ fontWeight: 500 }}>DimInspect</div>
            <div className="text-[11px] text-blue-300">Quality Monitoring</div>
          </div>
        </div>

        <nav className="mt-4 px-3 space-y-1">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-white/10 hover:text-white'}`
              }
            >
              <item.icon className="w-[18px] h-[18px]" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-white/10">
          {userMenuOpen && (
            <div className="mb-3 rounded-xl bg-white/10 p-2 text-sm shadow-lg">
              <button onClick={toggleTheme} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-gray-200 hover:bg-white/10 hover:text-white">
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                {theme === 'dark' ? 'Mode terang' : 'Mode gelap'}
              </button>
              <button onClick={handleLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-gray-200 hover:bg-white/10 hover:text-white">
                <LogOut className="w-4 h-4" /> Keluar
              </button>
            </div>
          )}
          <button onClick={() => setUserMenuOpen((open) => !open)} className="flex w-full items-center gap-3 rounded-xl p-2 hover:bg-white/10 text-left">
            <div className="w-8 h-8 rounded-full bg-blue-500/30 flex items-center justify-center text-sm">
              {user?.name?.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{user?.name}</div>
              <div className="text-[11px] text-gray-400">{roleLabels[user?.role || '']}</div>
            </div>
            <ChevronUp className={`w-4 h-4 text-gray-400 transition-transform ${userMenuOpen ? '' : 'rotate-180'}`} />
          </button>
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-[var(--border)] flex items-center justify-between px-4 bg-[var(--card)] shrink-0">
          <button className="lg:hidden p-1.5 hover:bg-[var(--accent)] rounded-md" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1" />
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
