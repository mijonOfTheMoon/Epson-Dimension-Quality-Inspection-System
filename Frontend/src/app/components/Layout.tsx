import { Outlet, NavLink, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard, ScanLine, History, AlertTriangle, Settings, Users, LogOut,
  Bell, Menu, X, Package, ChevronDown, Video
} from 'lucide-react';
import { useState } from 'react';
import { notifications } from '../data/mock-data';
import Logo from '../../assets/Logo.png';

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
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleLogout = () => { logout(); navigate('/'); };

  const navItems = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['operator', 'qc', 'supervisor', 'engineering', 'admin'] },
    { to: '/live-tracking', icon: Video, label: 'Live Tracking', roles: ['operator', 'qc', 'supervisor', 'engineering', 'admin'] },
    { to: '/history', icon: History, label: 'Riwayat Inspeksi', roles: ['operator', 'qc', 'supervisor', 'engineering', 'admin'] },
    { to: '/quality-tracking', icon: AlertTriangle, label: 'Quality Tracking', roles: ['engineering', 'supervisor', 'vendor', 'admin'] },
    { to: '/parts', icon: Package, label: 'Konfigurasi Part', roles: ['qc', 'supervisor', 'admin'] },
    { to: '/users', icon: Users, label: 'Manajemen User', roles: ['admin'] },
  ];

  const visibleItems = navItems.filter((item) => item.roles.some((r) => hasRole(r as any)));

  return (
    <div className="flex h-screen bg-[var(--background)]">
      {/* Sidebar */}
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
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-blue-500/30 flex items-center justify-center text-sm">
              {user?.name?.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{user?.name}</div>
              <div className="text-[11px] text-gray-400">{roleLabels[user?.role || '']}</div>
            </div>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white w-full px-1">
            <LogOut className="w-4 h-4" /> Keluar
          </button>
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-[var(--border)] flex items-center justify-between px-4 bg-[var(--card)] shrink-0">
          <button className="lg:hidden p-1.5 hover:bg-[var(--accent)] rounded-md" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1" />
          <div className="relative">
            <button onClick={() => setNotifOpen(!notifOpen)} className="relative p-2 hover:bg-[var(--accent)] rounded-md">
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="absolute right-0 mt-2 w-80 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
                <div className="p-3 border-b border-[var(--border)]">
                  <h4 className="text-sm">Notifikasi</h4>
                </div>
                {notifications.map((n) => (
                  <div key={n.id} className={`p-3 border-b border-[var(--border)] text-sm ${!n.read ? 'bg-blue-50' : ''}`}>
                    <div style={{ fontWeight: 500 }}>{n.title}</div>
                    <div className="text-[var(--muted-foreground)] mt-0.5 text-xs">{n.message}</div>
                    <div className="text-[10px] text-[var(--muted-foreground)] mt-1">{new Date(n.timestamp).toLocaleString('id-ID')}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}