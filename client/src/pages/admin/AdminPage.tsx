import type { AuditLog, Page, User } from '@ibutest/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorAlert, Loading, Modal, Pagination, Tabs, copyText, formatDate, useAction, useDebounced, useFeedback } from '../../components/ui';

function TemporaryPassword({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  const { toast } = useFeedback();
  return (
    <Modal title="Temporary password" onClose={onClose} footer={<button className="btn primary" type="button" onClick={onClose}>Done</button>}>
      <div className="stack">
        <p className="text-2">
          Share this password with <strong>{email}</strong> through a secure channel. It is shown only once; the user must change it at first sign-in.
        </p>
        <code className="token">{password}</code>
        <button className="btn" type="button" onClick={() => copyText(password).then(() => toast('Copied'))}>
          Copy password
        </button>
      </div>
    </Modal>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (email: string, password: string | null) => void }) {
  const [form, setForm] = useState({ email: '', name: '', role: 'user' as 'user' | 'admin' });
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await api<{ user: User; temporaryPassword: string | null }>('/admin/users', { method: 'POST', body: form });
      onCreated(res.user.email, res.temporaryPassword);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Modal title="Add user" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {error && <div className="alert error">{error}</div>}
        <div className="field">
          <label htmlFor="u-name">Full name</label>
          <input id="u-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} required />
        </div>
        <div className="field">
          <label htmlFor="u-email">Email</label>
          <input id="u-email" className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="u-role">System role</label>
          <select id="u-role" className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'user' | 'admin' })}>
            <option value="user">User</option>
            <option value="admin">Administrator</option>
          </select>
          <span className="hint">A temporary password is generated; the user must change it at first sign-in.</span>
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Create user
          </button>
        </div>
      </form>
    </Modal>
  );
}

function UsersTab() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const { confirm } = useFeedback();
  const run = useAction();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const debounced = useDebounced(search);
  const query = useQuery({
    queryKey: ['admin-users', debounced, page],
    queryFn: () => api<Page<User>>('/admin/users', { query: { search: debounced, page } }),
    placeholderData: keepPreviousData,
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] });

  async function resetPassword(u: User) {
    if (!(await confirm({ title: 'Reset password', message: `Generate a new temporary password for ${u.email}? All of their sessions will be signed out.`, confirmText: 'Reset' }))) return;
    const res = await run(() => api<{ temporaryPassword: string }>(`/admin/users/${u.id}/reset-password`, { method: 'POST' }));
    if (res) setTemp({ email: u.email, password: res.temporaryPassword });
  }

  return (
    <div className="card flush">
      <div className="card-header">
        <input className="input search" placeholder="Search users…" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} aria-label="Search users" />
        <button className="btn primary" type="button" onClick={() => setCreating(true)}>
          <Plus size={16} /> Add user
        </button>
      </div>
      <ErrorAlert error={query.error} />
      {query.isLoading ? (
        <Loading />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>2FA</th>
                  <th>Last sign-in</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {query.data?.items.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td>
                      <select
                        className="select sm"
                        value={u.role}
                        disabled={u.id === me?.id}
                        aria-label={`Role of ${u.email}`}
                        onChange={(e) => run(() => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { role: e.target.value } }).then(reload), 'Role updated')}
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td>
                      {u.lockedUntil ? (
                        <span className="badge danger">Locked</span>
                      ) : u.isActive ? (
                        <span className="badge">Active</span>
                      ) : (
                        <span className="badge danger">Deactivated</span>
                      )}
                      {u.mustChangePassword && <span className="badge"> Must change password</span>}
                    </td>
                    <td>{u.mfaEnabled ? 'On' : 'Off'}</td>
                    <td className="nowrap">{formatDate(u.lastLoginAt, true)}</td>
                    <td>
                      <div className="btn-group">
                        {u.lockedUntil && (
                          <button className="btn sm" type="button" onClick={() => run(() => api(`/admin/users/${u.id}/unlock`, { method: 'POST' }).then(reload), 'Unlocked')}>
                            Unlock
                          </button>
                        )}
                        <button className="btn sm" type="button" onClick={() => void resetPassword(u)}>
                          Reset password
                        </button>
                        {u.mfaEnabled && (
                          <button className="btn sm" type="button" onClick={() => run(() => api(`/admin/users/${u.id}/mfa`, { method: 'DELETE' }).then(reload), '2FA reset')}>
                            Reset 2FA
                          </button>
                        )}
                        <button className="btn sm" type="button" onClick={() => run(() => api(`/admin/users/${u.id}/revoke-sessions`, { method: 'POST' }), 'Sessions revoked')}>
                          Sign out
                        </button>
                        {u.id !== me?.id && (
                          <button
                            className={`btn sm ${u.isActive ? 'danger' : ''}`}
                            type="button"
                            onClick={() => run(() => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.isActive } }).then(reload), u.isActive ? 'User deactivated' : 'User reactivated')}
                          >
                            {u.isActive ? 'Deactivate' : 'Reactivate'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {query.data && <Pagination page={query.data.page} totalPages={query.data.totalPages} total={query.data.total} onPage={setPage} />}
        </>
      )}
      {creating && (
        <CreateUserModal
          onClose={() => setCreating(false)}
          onCreated={(email, password) => {
            setCreating(false);
            void reload();
            if (password) setTemp({ email, password });
          }}
        />
      )}
      {temp && <TemporaryPassword email={temp.email} password={temp.password} onClose={() => setTemp(null)} />}
    </div>
  );
}

function AuditTab() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(action);
  const query = useQuery({
    queryKey: ['audit', debounced, page],
    queryFn: () => api<Page<AuditLog>>('/admin/audit-logs', { query: { action: debounced, page, pageSize: 50 } }),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="card flush">
      <div className="card-header">
        <input className="input search" placeholder="Filter by action prefix, e.g. auth." value={action} onChange={(e) => (setAction(e.target.value), setPage(1))} aria-label="Filter actions" />
      </div>
      <ErrorAlert error={query.error} />
      {query.isLoading ? (
        <Loading />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Target</th>
                  <th>IP</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {query.data?.items.map((l) => (
                  <tr key={l.id}>
                    <td className="nowrap">{formatDate(l.createdAt, true)}</td>
                    <td className="mono">{l.action}</td>
                    <td>{l.actorEmail || '-'}</td>
                    <td className="small">{l.entityType ? `${l.entityType} ${l.entityId?.slice(0, 8) ?? ''}` : '-'}</td>
                    <td className="mono">{l.ip}</td>
                    <td className="mono small truncate" title={JSON.stringify(l.details)}>
                      {Object.keys(l.details).length ? JSON.stringify(l.details) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {query.data && <Pagination page={query.data.page} totalPages={query.data.totalPages} total={query.data.total} onPage={setPage} />}
        </>
      )}
    </div>
  );
}

interface SystemInfo {
  version: string;
  environment: string;
  database: string;
  aiConfigured: boolean;
  aiModel: string | null;
  registrationEnabled: boolean;
  adminRequireMfa: boolean;
  counts: { users: number; projects: number; testCases: number };
}

function SystemTab() {
  const query = useQuery({ queryKey: ['system'], queryFn: () => api<SystemInfo>('/admin/system') });
  if (query.isLoading) return <Loading />;
  if (!query.data) return <ErrorAlert error={query.error} />;
  const s = query.data;
  return (
    <div className="card">
      <dl className="kv">
        <dt>Version</dt>
        <dd>{s.version}</dd>
        <dt>Environment</dt>
        <dd>{s.environment}</dd>
        <dt>Database</dt>
        <dd>{s.database === 'postgres' ? 'PostgreSQL' : 'Embedded (PGlite)'}</dd>
        <dt>AI assistant</dt>
        <dd>{s.aiConfigured ? `Enabled (${s.aiModel})` : 'Not configured (set ANTHROPIC_API_KEY on the server)'}</dd>
        <dt>Self registration</dt>
        <dd>{s.registrationEnabled ? 'Enabled' : 'Disabled'}</dd>
        <dt>2FA required for admins</dt>
        <dd>{s.adminRequireMfa ? 'Yes' : 'No'}</dd>
        <dt>Users / projects / test cases</dt>
        <dd>
          {s.counts.users} / {s.counts.projects} / {s.counts.testCases}
        </dd>
      </dl>
    </div>
  );
}

export function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'users' | 'audit' | 'system'>('users');
  if (user?.role !== 'admin') return <div className="alert error">Administrator access required.</div>;
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Administration</h1>
          <p className="subtitle">Users, security audit trail and system configuration.</p>
        </div>
      </div>
      <Tabs
        tabs={[
          { id: 'users', label: 'Users' },
          { id: 'audit', label: 'Audit log' },
          { id: 'system', label: 'System' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'users' ? <UsersTab /> : tab === 'audit' ? <AuditTab /> : <SystemTab />}
    </>
  );
}
