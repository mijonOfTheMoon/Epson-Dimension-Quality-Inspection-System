import { UserPlus, Shield, Edit, Trash2 } from 'lucide-react';
import { useUsers } from '../hooks/useUsers';

const roleBadge: Record<string, string> = {
  operator: 'bg-blue-100 text-blue-700',
  qc: 'bg-green-100 text-green-700',
  supervisor: 'bg-purple-100 text-purple-700',
  engineering: 'bg-orange-100 text-orange-700',
  admin: 'bg-red-100 text-red-700',
  vendor: 'bg-gray-100 text-gray-700',
};

const roleLabels: Record<string, string> = {
  operator: 'Operator',
  qc: 'Quality Control',
  supervisor: 'Supervisor',
  engineering: 'Engineering',
  admin: 'Admin',
  vendor: 'Vendor',
};

export function UsersPage() {
  const users = useUsers();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1>Manajemen User</h1>
          <p className="text-[var(--muted-foreground)] text-sm mt-1">Kelola akun pengguna dan hak akses (RBAC)</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
          <UserPlus className="w-4 h-4" /> Tambah User
        </button>
      </div>

      {users.error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm flex items-center justify-between gap-3">
          <span>{users.error}</span>
          <button onClick={users.reload} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs">Coba lagi</button>
        </div>
      )}

      {users.loading && (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 text-sm text-[var(--muted-foreground)]">
          Memuat user dari backend...
        </div>
      )}

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--accent)]">
            <tr className="text-left">
              <th className="px-4 py-3">Nama</th>
              <th className="px-4 py-3">Username</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {users.data.map((u) => (
              <tr key={u.id} className="border-b border-[var(--border)]">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm text-blue-600" style={{ fontWeight: 500 }}>
                      {u.name.charAt(0)}
                    </div>
                    {u.name}
                  </div>
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">{u.username}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${roleBadge[u.role]}`}>
                    <Shield className="w-3 h-3" /> {roleLabels[u.role]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button className="p-1.5 hover:bg-[var(--accent)] rounded"><Edit className="w-4 h-4" /></button>
                    <button className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
            {!users.loading && users.data.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-[var(--muted-foreground)]">
                  Belum ada user dari backend.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
