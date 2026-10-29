import {
  PRIORITIES,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
  type Page,
  type Requirement,
  type RequirementStatus,
  type TestCaseStatus,
} from '@ibutest/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FileText, Link2, Plus, Sparkles, Trash2, Unlink } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, downloadFile } from '../../api/client';
import { AiGenerateModal } from '../../components/AiGenerate';
import { Attachments } from '../../components/Attachments';
import { FolderSelect, FolderTree, type FolderSelection } from '../../components/FolderTree';
import { useProject } from '../../components/Layout';
import { TestCasePicker } from '../../components/TestCasePicker';
import {
  Empty,
  ErrorAlert,
  KeyBadge,
  Loading,
  Modal,
  Pagination,
  PriorityBadge,
  StatusText,
  formatDate,
  label,
  useAction,
  useDebounced,
  useFeedback,
} from '../../components/ui';
import { useAuth } from '../../auth/AuthProvider';

type RequirementForm = Pick<Requirement, 'title' | 'description' | 'priority' | 'status' | 'type' | 'folderId' | 'externalRef'>;

function RequirementFields({ form, setForm, projectId }: { form: RequirementForm; setForm: (f: RequirementForm) => void; projectId: string }) {
  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="r-title">Title</label>
        <input id="r-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={255} required />
      </div>
      <div className="field">
        <label htmlFor="r-desc">Description &amp; acceptance criteria</label>
        <textarea id="r-desc" className="textarea" rows={8} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={20000} />
      </div>
      <div className="grid-3">
        <div className="field">
          <label htmlFor="r-type">Type</label>
          <select id="r-type" className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as RequirementForm['type'] })}>
            {REQUIREMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="r-prio">Priority</label>
          <select id="r-prio" className="select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as RequirementForm['priority'] })}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {label(p)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="r-status">Status</label>
          <select id="r-status" className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as RequirementStatus })}>
            {REQUIREMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="r-folder">Folder</label>
          <FolderSelect id="r-folder" projectId={projectId} kind="requirement" value={form.folderId} onChange={(folderId) => setForm({ ...form, folderId })} />
        </div>
        <div className="field">
          <label htmlFor="r-ext">External reference</label>
          <input id="r-ext" className="input" value={form.externalRef} onChange={(e) => setForm({ ...form, externalRef: e.target.value })} maxLength={100} placeholder="e.g. JIRA-123" />
        </div>
      </div>
    </div>
  );
}

const EMPTY: RequirementForm = { title: '', description: '', priority: 'medium', status: 'draft', type: 'functional', folderId: null, externalRef: '' };

export function RequirementsPage() {
  const { project, can } = useProject();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const run = useAction();
  const [folder, setFolder] = useState<FolderSelection>('all');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState<RequirementForm | null>(null);
  const debounced = useDebounced(search);
  const params = { folderId: folder === 'all' ? undefined : (folder ?? undefined), search: debounced, status, page };
  const query = useQuery({
    queryKey: ['requirements', project.id, params],
    queryFn: () => api<Page<Requirement>>(`/projects/${project.id}/requirements`, { query: params }),
    placeholderData: keepPreviousData,
  });

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!creating) return;
    const res = await run(() => api<{ requirement: Requirement }>(`/projects/${project.id}/requirements`, { method: 'POST', body: creating }));
    if (res) {
      setCreating(null);
      void queryClient.invalidateQueries({ queryKey: ['requirements', project.id] });
      navigate(`/p/${project.id}/requirements/${res.requirement.id}`);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Requirements</h1>
          <p className="subtitle">Capture what must be tested and trace it to test cases.</p>
        </div>
        <div className="row wrap">
          <button type="button" className="btn" onClick={() => run(() => downloadFile(`/projects/${project.id}/reports/export/requirements.csv`, 'requirements.csv'))}>
            <Download size={16} /> Export CSV
          </button>
          {can('tester') && (
            <button type="button" className="btn primary" onClick={() => setCreating({ ...EMPTY, folderId: folder === 'all' ? null : folder })}>
              <Plus size={16} /> New requirement
            </button>
          )}
        </div>
      </div>
      <div className="split">
        <FolderTree projectId={project.id} kind="requirement" selected={folder} onSelect={(f) => (setFolder(f), setPage(1))} canEdit={can('tester')} canDelete={can('lead')} />
        <div className="card flush">
          <div className="card-header">
            <div className="toolbar" style={{ margin: 0, flex: 1 }}>
              <input className="input search" placeholder="Search title or key (RQ-12)…" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} aria-label="Search requirements" />
              <select className="select" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Filter by status">
                <option value="">All statuses</option>
                {REQUIREMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <ErrorAlert error={query.error} />
          {query.isLoading ? (
            <Loading />
          ) : query.data?.items.length ? (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Title</th>
                      <th>Type</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th className="num">Tests</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.items.map((r) => (
                      <tr key={r.id} className="clickable" onClick={() => navigate(`/p/${project.id}/requirements/${r.id}`)}>
                        <td>
                          <KeyBadge value={r.key} />
                        </td>
                        <td className="title-cell">
                          <Link to={`/p/${project.id}/requirements/${r.id}`} onClick={(e) => e.stopPropagation()}>
                            {r.title}
                          </Link>
                        </td>
                        <td className="nowrap">{label(r.type)}</td>
                        <td>
                          <PriorityBadge priority={r.priority} />
                        </td>
                        <td>
                          <StatusText value={r.status} />
                        </td>
                        <td className={`num ${r.linkedTestCases ? '' : 'muted'}`}>{r.linkedTestCases ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={query.data.page} totalPages={query.data.totalPages} total={query.data.total} onPage={setPage} />
            </>
          ) : (
            <Empty icon={FileText} title="No requirements found" />
          )}
        </div>
      </div>
      {creating && (
        <Modal title="New requirement" onClose={() => setCreating(null)} wide>
          <form className="stack" onSubmit={create}>
            <RequirementFields form={creating} setForm={setCreating} projectId={project.id} />
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setCreating(null)}>
                Cancel
              </button>
              <button type="submit" className="btn primary">
                Create requirement
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

interface RequirementDetail {
  requirement: Requirement;
  testCases: { id: string; key: string; title: string; status: TestCaseStatus; priority: Requirement['priority'] }[];
}

export function RequirementDetailPage() {
  const { project, can } = useProject();
  const { status: authStatus } = useAuth();
  const { requirementId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const run = useAction();
  const { confirm, toast } = useFeedback();
  const [form, setForm] = useState<RequirementForm | null>(null);
  const [linking, setLinking] = useState(false);
  const [generating, setGenerating] = useState(false);
  const key = ['requirement', project.id, requirementId];
  const query = useQuery({ queryKey: key, queryFn: () => api<RequirementDetail>(`/projects/${project.id}/requirements/${requirementId}`) });
  useEffect(() => {
    if (query.data) {
      const r = query.data.requirement;
      setForm({ title: r.title, description: r.description, priority: r.priority, status: r.status, type: r.type, folderId: r.folderId, externalRef: r.externalRef });
    }
  }, [query.data]);
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ['requirements', project.id] });
  };

  if (query.isLoading || !form) return query.error ? <ErrorAlert error={query.error} /> : <Loading />;
  const r = query.data!.requirement;
  const editable = can('tester');

  return (
    <>
      <div className="page-header">
        <div className="stack tight">
          <Link to={`/p/${project.id}/requirements`} className="row small">
            <ArrowLeft size={14} /> Requirements
          </Link>
          <h1 className="row wrap">
            <KeyBadge value={r.key} /> {r.title}
          </h1>
          <p className="subtitle">
            Created {formatDate(r.createdAt)} by {r.createdByName ?? 'unknown'} · updated {formatDate(r.updatedAt, true)}
          </p>
        </div>
        <div className="row wrap">
          {editable && authStatus?.aiAvailable && project.aiEnabled && (
            <button type="button" className="btn ai" onClick={() => setGenerating(true)}>
              <Sparkles size={16} /> Generate test cases
            </button>
          )}
          {can('lead') && (
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                if (!(await confirm({ title: 'Delete requirement', message: `Delete ${r.key}? Links to test cases are removed; test cases are kept.`, confirmText: 'Delete' }))) return;
                if ((await run(() => api(`/projects/${project.id}/requirements/${r.id}`, { method: 'DELETE' }), 'Requirement deleted')) !== undefined) {
                  void queryClient.invalidateQueries({ queryKey: ['requirements', project.id] });
                  navigate(`/p/${project.id}/requirements`);
                }
              }}
            >
              <Trash2 size={16} /> Delete
            </button>
          )}
        </div>
      </div>
      <div className="split detail">
        <form
          className="card stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if ((await run(() => api(`/projects/${project.id}/requirements/${r.id}`, { method: 'PATCH', body: form }), 'Saved')) !== undefined) reload();
          }}
        >
          <fieldset disabled={!editable} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            <RequirementFields form={form} setForm={setForm} projectId={project.id} />
          </fieldset>
          {editable && (
            <div className="form-actions">
              <button type="submit" className="btn primary">
                Save changes
              </button>
            </div>
          )}
        </form>
        <div className="stack">
          <div className="card stack tight">
            <div className="row between">
              <span className="section-title">Linked test cases ({query.data!.testCases.length})</span>
              {editable && (
                <button type="button" className="btn sm" onClick={() => setLinking(true)}>
                  <Link2 size={14} /> Link
                </button>
              )}
            </div>
            {query.data!.testCases.length === 0 ? (
              <p className="small muted">Not covered by any test case yet.</p>
            ) : (
              query.data!.testCases.map((t) => (
                <div key={t.id} className="row">
                  <KeyBadge value={t.key} />
                  <Link to={`/p/${project.id}/test-cases/${t.id}`} className="grow truncate" title={t.title}>
                    {t.title}
                  </Link>
                  {editable && (
                    <button
                      type="button"
                      className="btn ghost sm icon"
                      title="Unlink"
                      onClick={() => run(() => api(`/projects/${project.id}/requirements/${r.id}/links/${t.id}`, { method: 'DELETE' })).then(reload)}
                    >
                      <Unlink size={14} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
          <Attachments projectId={project.id} entityType="requirement" entityId={r.id} canUpload={editable} canDeleteAny={can('lead')} />
        </div>
      </div>
      {linking && (
        <TestCasePicker
          projectId={project.id}
          title={`Link test cases to ${r.key}`}
          confirmText="Link selected"
          exclude={query.data!.testCases.map((t) => t.id)}
          onClose={() => setLinking(false)}
          onPick={async (ids) => {
            if ((await run(() => api(`/projects/${project.id}/requirements/${r.id}/links`, { method: 'POST', body: { testCaseIds: ids } }), 'Linked')) !== undefined) {
              setLinking(false);
              reload();
            }
          }}
        />
      )}
      {generating && (
        <AiGenerateModal
          projectId={project.id}
          requirementId={r.id}
          requirementTitle={r.title}
          onClose={() => setGenerating(false)}
          onSaved={(n) => {
            setGenerating(false);
            toast(`${n} test case${n === 1 ? '' : 's'} created and linked`);
            reload();
            void queryClient.invalidateQueries({ queryKey: ['testCases', project.id] });
          }}
        />
      )}
    </>
  );
}
