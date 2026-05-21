import { useState, type ReactNode } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUsers } from '../hooks/useUsers';
import { api, getErrorMessage } from '../services/api';
import type { User, UserRole } from '../types/api';

const ROLES: UserRole[] = ['operator', 'qc', 'supervisor', 'engineering', 'admin', 'vendor'];

const emptyForm = () => ({
  username: '',
  password: '',
  name: '',
  role: 'operator' as UserRole,
  avatar: '',
});

export function UserManagementPage() {
  const { user: currentUser } = useAuth();
  const users = useUsers();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edit = (user: User) => {
    setEditingId(user.id);
    setForm({
      username: user.username,
      password: '',
      name: user.name,
      role: user.role,
      avatar: user.avatar ?? '',
    });
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await api.updateUser(editingId, {
          username: form.username,
          name: form.name,
          role: form.role,
          avatar: form.avatar || undefined,
          password: form.password || undefined,
        });
      } else {
        await api.createUser({
          username: form.username,
          password: form.password,
          name: form.name,
          role: form.role,
          avatar: form.avatar || undefined,
        });
      }
      users.reload();
      setEditingId(null);
      setForm(emptyForm());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (user: User) => {
    if (!window.confirm(`Hapus user ${user.username}?`)) return;
    setError(null);
    try {
      await api.deleteUser(user.id);
      users.reload();
      if (editingId === user.id) {
        setEditingId(null);
        setForm(emptyForm());
      }
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1>Manajemen User</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">Kelola akun dan role pengguna.</p>
        </div>
        <button
          onClick={() => { setEditingId(null); setForm(emptyForm()); setError(null); }}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--accent)]"
        >
          <Plus className="w-4 h-4" /> User baru
        </button>
      </div>

      {error && <Notice text={error} />}
      {users.error && <Notice text={users.error} />}

      <div className="grid xl:grid-cols-[380px_1fr] gap-4">
        <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[var(--border)]">
            <h3 className="text-sm">Daftar User</h3>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {users.data.map((user) => (
              <div key={user.id} className={`p-4 flex items-start justify-between gap-3 ${editingId === user.id ? 'bg-blue-50/60' : ''}`}>
                <button onClick={() => edit(user)} className="text-left min-w-0">
                  <div className="font-medium truncate">{user.name}</div>
                  <div className="text-xs text-[var(--muted-foreground)] truncate">{user.username} - {user.role}</div>
                </button>
                <button
                  disabled={currentUser?.id === user.id}
                  onClick={() => void remove(user)}
                  className="p-1.5 rounded-md text-red-600 hover:bg-red-50 disabled:opacity-40"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4 space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Nama">
              <input value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} className="input" />
            </Field>
            <Field label="Username">
              <input value={form.username} onChange={(e) => setForm((current) => ({ ...current, username: e.target.value }))} className="input" />
            </Field>
            <Field label={editingId ? 'Password baru (opsional)' : 'Password'}>
              <input type="password" value={form.password} onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))} className="input" />
            </Field>
            <Field label="Role">
              <select value={form.role} onChange={(e) => setForm((current) => ({ ...current, role: e.target.value as UserRole }))} className="input">
                {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </Field>
            <Field label="Avatar URL (opsional)">
              <input value={form.avatar} onChange={(e) => setForm((current) => ({ ...current, avatar: e.target.value }))} className="input" />
            </Field>
          </div>
          <button disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50">
            <Save className="w-4 h-4" /> {editingId ? 'Simpan perubahan' : 'Buat user'}
          </button>
        </section>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-xs text-[var(--muted-foreground)]">{label}</span>
      {children}
    </label>
  );
}

function Notice({ text }: { text: string }) {
  return <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">{text}</div>;
}
