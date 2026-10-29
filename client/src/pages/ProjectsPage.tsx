import type { Project } from '@ibutest/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderKanban, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { Empty, ErrorAlert, Loading, Modal, label } from '../components/ui';

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ key: '', name: '', description: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<{ project: Project }>('/projects', { method: 'POST', body: form });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/p/${res.project.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <Modal title="New project" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {error && <div className="alert error">{error}</div>}
        <div className="grid-2">
          <div className="field">
            <label htmlFor="p-key">Key</label>
            <input
              id="p-key"
              className="input mono"
              value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
              maxLength={10}
              placeholder="SHOP"
              required
            />
            <span className="hint">2-10 letters/digits, e.g. SHOP</span>
          </div>
          <div className="field">
            <label htmlFor="p-name">Name</label>
            <input id="p-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} required />
          </div>
        </div>
        <div className="field">
          <label htmlFor="p-desc">Description</label>
          <textarea id="p-desc" className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={5000} />
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            Create project
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ProjectsPage() {
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const query = useQuery({ queryKey: ['projects'], queryFn: () => api<{ items: Project[] }>('/projects').then((r) => r.items) });
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Projects</h1>
          <p className="subtitle">Requirements, test design, execution and defects - organised per project.</p>
        </div>
        {user?.role === 'admin' && (
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> New project
          </button>
        )}
      </div>
      <ErrorAlert error={query.error} />
      {query.isLoading ? (
        <Loading />
      ) : query.data?.length ? (
        <div className="cards">
          {query.data.map((p) => (
            <Link key={p.id} to={`/p/${p.id}`} className="card project-card">
              <div className="row between">
                <span className="badge key">{p.key}</span>
                <span className="badge">{label(p.role)}</span>
              </div>
              <h2 className="truncate">{p.name}</h2>
              <p className="muted small truncate">{p.description || 'No description'}</p>
              {p.isArchived && <span className="badge danger">Archived</span>}
            </Link>
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty icon={FolderKanban} title="No projects yet">
            {user?.role === 'admin' ? 'Create your first project to start writing test cases.' : 'Ask an administrator to add you to a project.'}
          </Empty>
        </div>
      )}
      {creating && <NewProjectModal onClose={() => setCreating(false)} />}
    </>
  );
}
