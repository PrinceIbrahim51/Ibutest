import { PROJECT_ROLES, type ApiToken, type Project, type ProjectRole } from '@ibutest/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, Trash2, UserPlus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, apiBase } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { useProject } from '../../components/Layout';
import { useMembers } from '../../components/MemberSelect';
import { ErrorAlert, Loading, Modal, Tabs, copyText, formatDate, label, useAction, useDebounced, useFeedback } from '../../components/ui';

const ROLE_HELP: Record<ProjectRole, string> = {
  viewer: 'Read-only access',
  tester: 'Write and execute tests, report defects',
  lead: 'Approve test cases, plan releases and cycles, delete items',
  manager: 'Everything, plus project settings and members',
};

function GeneralTab() {
  const { project } = useProject();
  const { user, status } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const run = useAction();
  const { confirm } = useFeedback();
  const [form, setForm] = useState({ name: project.name, description: project.description, aiEnabled: project.aiEnabled });
  const isManager = project.role === 'manager';
  const save = async (body: Partial<Project>) => {
    if ((await run(() => api(`/projects/${project.id}`, { method: 'PATCH', body }), 'Project updated')) !== undefined) {
      void queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    }
  };
  return (
    <div className="stack">
      <form
        className="card stack"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void save(form);
        }}
      >
        <fieldset disabled={!isManager || project.isArchived} className="stack" style={{ border: 0, margin: 0, padding: 0 }}>
          <div className="field">
            <label htmlFor="ps-name">Project name</label>
            <input id="ps-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} required />
          </div>
          <div className="field">
            <label htmlFor="ps-desc">Description</label>
            <textarea id="ps-desc" className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={5000} />
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={form.aiEnabled} onChange={(e) => setForm({ ...form, aiEnabled: e.target.checked })} />
            Allow AI assistant features in this project {!status?.aiAvailable && <span className="muted small">(not configured on the server)</span>}
          </label>
        </fieldset>
        {isManager && !project.isArchived && (
          <div className="form-actions">
            <button className="btn primary" type="submit">
              Save
            </button>
          </div>
        )}
      </form>
      {isManager && (
        <div className="card stack">
          <h2>Danger zone</h2>
          <div className="row between wrap">
            <span className="text-2">{project.isArchived ? 'Restore the project to make it editable again.' : 'Archive the project to make it read-only.'}</span>
            <button type="button" className="btn" onClick={() => void save({ isArchived: !project.isArchived })}>
              {project.isArchived ? 'Unarchive project' : 'Archive project'}
            </button>
          </div>
          {user?.role === 'admin' && (
            <div className="row between wrap">
              <span className="text-2">Permanently delete the project and all of its data.</span>
              <button
                type="button"
                className="btn danger"
                onClick={async () => {
                  if (!(await confirm({ title: 'Delete project', message: `Permanently delete ${project.key} - ${project.name}, including all test cases, runs and defects? This cannot be undone.`, confirmText: 'Delete project' }))) return;
                  if ((await run(() => api(`/projects/${project.id}`, { method: 'DELETE' }), 'Project deleted')) !== undefined) {
                    void queryClient.invalidateQueries({ queryKey: ['projects'] });
                    navigate('/');
                  }
                }}
              >
                Delete project
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddMemberModal({ onClose }: { onClose: () => void }) {
  const { project } = useProject();
  const queryClient = useQueryClient();
  const run = useAction();
  const [q, setQ] = useState('');
  const [role, setRole] = useState<ProjectRole>('tester');
  const debounced = useDebounced(q);
  const users = useQuery({
    queryKey: ['user-lookup', debounced],
    queryFn: () => api<{ items: { id: string; name: string; email: string }[] }>('/users/lookup', { query: { q: debounced } }).then((r) => r.items),
  });
  const members = useMembers(project.id);
  const existing = new Set(members.data?.map((m) => m.userId));
  return (
    <Modal title="Add member" onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          <input className="input" placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as ProjectRole)} aria-label="Role">
            {PROJECT_ROLES.map((r) => (
              <option key={r} value={r}>
                {label(r)}
              </option>
            ))}
          </select>
        </div>
        <p className="small muted">{ROLE_HELP[role]}</p>
        <ErrorAlert error={users.error} />
        <div className="stack tight">
          {users.data?.map((u) => (
            <div key={u.id} className="row">
              <div className="grow">
                <div>{u.name}</div>
                <div className="small muted">{u.email}</div>
              </div>
              {existing.has(u.id) ? (
                <span className="badge">Member</span>
              ) : (
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={() =>
                    run(() => api(`/projects/${project.id}/members`, { method: 'PUT', body: { userId: u.id, role } }), `${u.name} added`).then(() =>
                      queryClient.invalidateQueries({ queryKey: ['members', project.id] }),
                    )
                  }
                >
                  Add
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function MembersTab() {
  const { project } = useProject();
  const queryClient = useQueryClient();
  const run = useAction();
  const { confirm } = useFeedback();
  const [adding, setAdding] = useState(false);
  const members = useMembers(project.id);
  const isManager = project.role === 'manager' && !project.isArchived;
  const reload = () => queryClient.invalidateQueries({ queryKey: ['members', project.id] });
  return (
    <div className="card flush">
      <div className="card-header">
        <h2>Members</h2>
        {isManager && (
          <button type="button" className="btn primary sm" onClick={() => setAdding(true)}>
            <UserPlus size={14} /> Add member
          </button>
        )}
      </div>
      {members.isLoading ? (
        <Loading />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.data?.map((m) => (
                <tr key={m.userId}>
                  <td>
                    {m.name} {!m.isActive && <span className="badge danger">Inactive</span>}
                  </td>
                  <td>{m.email}</td>
                  <td>
                    {isManager ? (
                      <select
                        className="select sm"
                        value={m.role}
                        aria-label={`Role of ${m.name}`}
                        onChange={(e) => run(() => api(`/projects/${project.id}/members`, { method: 'PUT', body: { userId: m.userId, role: e.target.value } }), 'Role updated').then(reload)}
                      >
                        {PROJECT_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {label(r)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      label(m.role)
                    )}
                  </td>
                  <td className="small muted nowrap">{formatDate(m.addedAt)}</td>
                  <td>
                    {isManager && (
                      <button
                        type="button"
                        className="btn ghost sm icon"
                        title="Remove member"
                        onClick={async () => {
                          if (!(await confirm({ title: 'Remove member', message: `Remove ${m.name} from ${project.key}? Their API tokens for this project are revoked.`, confirmText: 'Remove' }))) return;
                          await run(() => api(`/projects/${project.id}/members/${m.userId}`, { method: 'DELETE' }), 'Member removed');
                          void reload();
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ padding: 12 }} className="small muted">
        {PROJECT_ROLES.map((r) => (
          <div key={r}>
            <strong>{label(r)}:</strong> {ROLE_HELP[r]}
          </div>
        ))}
      </div>
      {adding && <AddMemberModal onClose={() => setAdding(false)} />}
    </div>
  );
}

function TokensTab() {
  const { project, can } = useProject();
  const queryClient = useQueryClient();
  const run = useAction();
  const { toast } = useFeedback();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('CI pipeline');
  const [days, setDays] = useState(90);
  const [created, setCreated] = useState<string | null>(null);
  const tokens = useQuery({ queryKey: ['tokens', project.id], queryFn: () => api<{ items: ApiToken[] }>(`/projects/${project.id}/api-tokens`).then((r) => r.items), enabled: can('tester') });
  const reload = () => queryClient.invalidateQueries({ queryKey: ['tokens', project.id] });
  const origin = apiBase().startsWith('http') ? apiBase().replace(/\/api$/, '') : window.location.origin;
  const example = `curl -X POST ${origin}/api/automation/v1/results \\
  -H "Authorization: Bearer $IBUTEST_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "cycleName": "Nightly regression",
    "results": [
      { "automationKey": "login.spec.ts::signs in", "status": "passed", "durationSeconds": 3.2 },
      { "automationKey": "login.spec.ts::rejects bad password", "status": "failed", "message": "Expected 401" }
    ]
  }'`;
  if (!can('tester')) return <div className="alert info">Testers and above can create automation tokens.</div>;
  return (
    <div className="stack">
      <div className="card flush">
        <div className="card-header">
          <h2 className="row">
            <KeyRound size={18} /> Automation API tokens
          </h2>
          <button type="button" className="btn primary sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> New token
          </button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Token</th>
                <th>Owner</th>
                <th>Expires</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tokens.data?.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="mono">{t.tokenPrefix}…</td>
                  <td>{t.ownerName}</td>
                  <td className="nowrap small">{formatDate(t.expiresAt)}</td>
                  <td className="nowrap small muted">{formatDate(t.lastUsedAt, true)}</td>
                  <td>
                    {t.revokedAt ? (
                      <span className="badge">Revoked</span>
                    ) : new Date(t.expiresAt) < new Date() ? (
                      <span className="badge">Expired</span>
                    ) : (
                      <button type="button" className="btn sm danger" onClick={() => run(() => api(`/projects/${project.id}/api-tokens/${t.id}`, { method: 'DELETE' }), 'Token revoked').then(reload)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {tokens.data?.length === 0 && <p className="muted small" style={{ padding: 12 }}>No tokens yet.</p>}
      </div>
      <div className="card stack">
        <h2>Upload results from CI</h2>
        <p className="text-2 small">
          Map automated tests to test cases with an automation key. Unknown keys create new automated test cases; results are recorded as runs in the named cycle. Store the token as a CI secret - never commit it.
        </p>
        <pre className="code">{example}</pre>
      </div>
      {creating && (
        <Modal title="New automation token" onClose={() => (setCreating(false), setCreated(null))}>
          {created ? (
            <div className="stack">
              <div className="alert warning">Copy this token now. It will not be shown again.</div>
              <code className="token">{created}</code>
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => copyText(created).then(() => toast('Copied'))}>
                  <Copy size={14} /> Copy
                </button>
                <button type="button" className="btn primary" onClick={() => (setCreating(false), setCreated(null))}>
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form
              className="stack"
              onSubmit={async (e) => {
                e.preventDefault();
                const res = await run(() => api<{ token: string }>(`/projects/${project.id}/api-tokens`, { method: 'POST', body: { name, expiresInDays: days } }));
                if (res) {
                  setCreated(res.token);
                  void reload();
                }
              }}
            >
              <div className="field">
                <label htmlFor="tk-name">Name</label>
                <input id="tk-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
              </div>
              <div className="field">
                <label htmlFor="tk-days">Expires in (days)</label>
                <input id="tk-days" className="input" type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} />
              </div>
              <p className="small muted">The token acts with your permissions in this project only, and stops working if you lose tester access.</p>
              <div className="form-actions">
                <button type="submit" className="btn primary">
                  Create token
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}

export function SettingsPage() {
  const [tab, setTab] = useState<'general' | 'members' | 'tokens'>('general');
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Project settings</h1>
          <p className="subtitle">Configuration, team access and integrations.</p>
        </div>
      </div>
      <Tabs
        tabs={[
          { id: 'general', label: 'General' },
          { id: 'members', label: 'Members' },
          { id: 'tokens', label: 'Automation & API' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'general' ? <GeneralTab /> : tab === 'members' ? <MembersTab /> : <TokensTab />}
    </>
  );
}
