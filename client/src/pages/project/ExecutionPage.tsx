import { PLAN_STATUSES, type AiCycleSummary, type Cycle, type PlanStatus, type Release, type TestRun } from '@ibutest/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bot, Download, FolderPlus, ListPlus, Pencil, PlayCircle, Plus, Sparkles, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, downloadFile } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { StatusLegend, StatusStackBar } from '../../components/charts';
import { FolderSelect } from '../../components/FolderTree';
import { useProject } from '../../components/Layout';
import { MemberSelect } from '../../components/MemberSelect';
import { TestCasePicker } from '../../components/TestCasePicker';
import {
  Empty,
  ErrorAlert,
  KeyBadge,
  Loading,
  Modal,
  PriorityBadge,
  RunStatusBadge,
  Spinner,
  StatusText,
  formatDate,
  label,
  useAction,
  useFeedback,
} from '../../components/ui';

interface PlanForm {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  status: PlanStatus;
  releaseId?: string;
}

function PlanModal({
  title,
  initial,
  releases,
  onClose,
  onSubmit,
}: {
  title: string;
  initial: PlanForm;
  releases?: Release[];
  onClose: () => void;
  onSubmit: (f: PlanForm) => Promise<void>;
}) {
  const [form, setForm] = useState(initial);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await onSubmit(form);
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="pl-name">Name</label>
          <input id="pl-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} required />
        </div>
        {releases && (
          <div className="field">
            <label htmlFor="pl-rel">Release</label>
            <select id="pl-rel" className="select" value={form.releaseId ?? ''} onChange={(e) => setForm({ ...form, releaseId: e.target.value })}>
              <option value="">(No release)</option>
              {releases.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="pl-desc">Description</label>
          <textarea id="pl-desc" className="textarea" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={5000} />
        </div>
        <div className="grid-3">
          <div className="field">
            <label htmlFor="pl-start">Start</label>
            <input id="pl-start" className="input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="pl-end">End</label>
            <input id="pl-end" className="input" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="pl-status">Status</label>
            <select id="pl-status" className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PlanStatus })}>
              {PLAN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

const planBody = (f: PlanForm, withRelease: boolean) => ({
  name: f.name,
  description: f.description,
  startDate: f.startDate || null,
  endDate: f.endDate || null,
  status: f.status,
  ...(withRelease ? { releaseId: f.releaseId || null } : {}),
});

const blankPlan = (): PlanForm => ({ name: '', description: '', startDate: '', endDate: '', status: 'planned', releaseId: '' });

export function ExecutionPage() {
  const { project, can } = useProject();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const run = useAction();
  const { confirm } = useFeedback();
  const [releaseFilter, setReleaseFilter] = useState('');
  const [modal, setModal] = useState<{ kind: 'release' | 'cycle'; edit?: Release } | null>(null);
  const releases = useQuery({ queryKey: ['releases', project.id], queryFn: () => api<{ items: Release[] }>(`/projects/${project.id}/releases`).then((r) => r.items) });
  const cycles = useQuery({
    queryKey: ['cycles', project.id, releaseFilter],
    queryFn: () => api<{ items: Cycle[] }>(`/projects/${project.id}/cycles`, { query: { releaseId: releaseFilter } }).then((r) => r.items),
  });
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: ['releases', project.id] });
    void queryClient.invalidateQueries({ queryKey: ['cycles', project.id] });
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Test execution</h1>
          <p className="subtitle">Plan releases and test cycles, assign runs and track progress.</p>
        </div>
        {can('lead') && (
          <div className="row wrap">
            <button type="button" className="btn" onClick={() => setModal({ kind: 'release' })}>
              <Plus size={16} /> Release
            </button>
            <button type="button" className="btn primary" onClick={() => setModal({ kind: 'cycle' })}>
              <Plus size={16} /> Test cycle
            </button>
          </div>
        )}
      </div>
      <div className="split">
        <div className="card stack tight">
          <span className="section-title">Releases</span>
          <button type="button" className={`tree-item${releaseFilter === '' ? ' active' : ''}`} onClick={() => setReleaseFilter('')}>
            All cycles
          </button>
          {releases.data?.map((r) => (
            <div key={r.id} className="tree-row">
              <button type="button" className={`tree-item${releaseFilter === r.id ? ' active' : ''}`} onClick={() => setReleaseFilter(r.id)}>
                <span className="grow truncate">{r.name}</span>
                <span className="small muted">{r.cycleCount}</span>
              </button>
              {can('lead') && (
                <span className="tree-actions">
                  <button type="button" className="btn ghost sm icon" title="Edit release" onClick={() => setModal({ kind: 'release', edit: r })}>
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm icon"
                    title="Delete release"
                    onClick={async () => {
                      if (!(await confirm({ title: 'Delete release', message: `Delete "${r.name}"? Its cycles are kept.`, confirmText: 'Delete' }))) return;
                      await run(() => api(`/projects/${project.id}/releases/${r.id}`, { method: 'DELETE' }), 'Release deleted');
                      if (releaseFilter === r.id) setReleaseFilter('');
                      reload();
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              )}
            </div>
          ))}
          {releases.data?.length === 0 && <p className="small muted">No releases yet.</p>}
        </div>
        <div className="card flush">
          <ErrorAlert error={cycles.error} />
          {cycles.isLoading ? (
            <Loading />
          ) : cycles.data?.length ? (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Cycle</th>
                      <th>Release</th>
                      <th>Status</th>
                      <th>Dates</th>
                      <th>Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycles.data.map((c) => (
                      <tr key={c.id} className="clickable" onClick={() => navigate(`/p/${project.id}/cycles/${c.id}`)}>
                        <td className="title-cell">
                          <Link to={`/p/${project.id}/cycles/${c.id}`} onClick={(e) => e.stopPropagation()}>
                            {c.name}
                          </Link>
                        </td>
                        <td>{c.releaseName ?? '-'}</td>
                        <td>
                          <StatusText value={c.status} />
                        </td>
                        <td className="nowrap small">
                          {c.startDate ?? '-'} → {c.endDate ?? '-'}
                        </td>
                        <td style={{ minWidth: 200 }}>
                          <StatusStackBar counts={c.counts} />
                          <span className="small muted">{c.counts.total} runs</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '10px 12px' }}>
                <StatusLegend />
              </div>
            </>
          ) : (
            <Empty icon={PlayCircle} title="No test cycles yet" />
          )}
        </div>
      </div>
      {modal?.kind === 'release' && (
        <PlanModal
          title={modal.edit ? 'Edit release' : 'New release'}
          initial={
            modal.edit
              ? { name: modal.edit.name, description: modal.edit.description, startDate: modal.edit.startDate ?? '', endDate: modal.edit.endDate ?? '', status: modal.edit.status }
              : blankPlan()
          }
          onClose={() => setModal(null)}
          onSubmit={async (f) => {
            const ok = await run(() =>
              modal.edit
                ? api(`/projects/${project.id}/releases/${modal.edit.id}`, { method: 'PATCH', body: planBody(f, false) })
                : api(`/projects/${project.id}/releases`, { method: 'POST', body: planBody(f, false) }),
            );
            if (ok !== undefined) {
              setModal(null);
              reload();
            }
          }}
        />
      )}
      {modal?.kind === 'cycle' && (
        <PlanModal
          title="New test cycle"
          initial={{ ...blankPlan(), releaseId: releaseFilter }}
          releases={releases.data ?? []}
          onClose={() => setModal(null)}
          onSubmit={async (f) => {
            const res = await run(() => api<{ cycle: Cycle }>(`/projects/${project.id}/cycles`, { method: 'POST', body: planBody(f, true) }));
            if (res) {
              setModal(null);
              reload();
              navigate(`/p/${project.id}/cycles/${res.cycle.id}`);
            }
          }}
        />
      )}
    </>
  );
}

function AddFolderModal({ projectId, onClose, onAdd }: { projectId: string; onClose: () => void; onAdd: (folderId: string) => Promise<void> }) {
  const [folderId, setFolderId] = useState<string | null>(null);
  return (
    <Modal
      title="Add a folder of test cases"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!folderId} onClick={() => folderId && void onAdd(folderId)}>
            Add folder
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="add-folder">Folder (including sub-folders; deprecated cases are skipped)</label>
        <FolderSelect id="add-folder" projectId={projectId} kind="test_case" value={folderId} onChange={setFolderId} />
      </div>
    </Modal>
  );
}

const READINESS: Record<AiCycleSummary['readiness'], string> = { ready: 'Ready to release', at_risk: 'At risk', not_ready: 'Not ready' };

export function CyclePage() {
  const { project, can } = useProject();
  const { status: authStatus } = useAuth();
  const { cycleId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const run = useAction();
  const { confirm } = useFeedback();
  const [adding, setAdding] = useState<'cases' | 'folder' | null>(null);
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState<AiCycleSummary | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const cycle = useQuery({ queryKey: ['cycle', project.id, cycleId], queryFn: () => api<{ cycle: Cycle }>(`/projects/${project.id}/cycles/${cycleId}`).then((r) => r.cycle) });
  const runs = useQuery({ queryKey: ['runs', project.id, cycleId], queryFn: () => api<{ items: TestRun[] }>(`/projects/${project.id}/cycles/${cycleId}/runs`).then((r) => r.items) });
  const releases = useQuery({ queryKey: ['releases', project.id], queryFn: () => api<{ items: Release[] }>(`/projects/${project.id}/releases`).then((r) => r.items), enabled: editing });
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: ['cycle', project.id, cycleId] });
    void queryClient.invalidateQueries({ queryKey: ['runs', project.id, cycleId] });
    void queryClient.invalidateQueries({ queryKey: ['cycles', project.id] });
  };

  if (cycle.isLoading) return <Loading />;
  if (!cycle.data) return <ErrorAlert error={cycle.error} />;
  const c = cycle.data;
  const closed = c.status === 'closed';

  async function addRuns(body: { testCaseIds?: string[]; folderId?: string }) {
    const res = await run(() => api<{ added: number; skipped: number }>(`/projects/${project.id}/cycles/${cycleId}/runs`, { method: 'POST', body }));
    if (res) {
      setAdding(null);
      reload();
    }
  }

  return (
    <>
      <div className="page-header">
        <div className="stack tight">
          <Link to={`/p/${project.id}/execution`} className="row small">
            <ArrowLeft size={14} /> Test execution
          </Link>
          <h1>{c.name}</h1>
          <p className="subtitle">
            {c.releaseName ? `${c.releaseName} · ` : ''}
            {label(c.status)} · {c.startDate ?? '-'} → {c.endDate ?? '-'}
          </p>
        </div>
        <div className="row wrap">
          {can('tester') && authStatus?.aiAvailable && project.aiEnabled && c.counts.total > 0 && (
            <button
              type="button"
              className="btn ai"
              disabled={summarizing}
              onClick={async () => {
                setSummarizing(true);
                const res = await run(() => api<{ summary: AiCycleSummary }>(`/projects/${project.id}/ai/summarize-cycle`, { method: 'POST', body: { cycleId } }));
                setSummarizing(false);
                if (res) setSummary(res.summary);
              }}
            >
              {summarizing ? <Spinner /> : <Sparkles size={16} />} Release readiness
            </button>
          )}
          <button type="button" className="btn" onClick={() => run(() => downloadFile(`/projects/${project.id}/reports/export/cycles/${cycleId}/runs.csv`, 'runs.csv'))}>
            <Download size={16} /> Export
          </button>
          {can('lead') && (
            <>
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                <Pencil size={16} /> Edit
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={async () => {
                  if (!(await confirm({ title: 'Delete test cycle', message: `Delete "${c.name}" and all of its runs and execution history?`, confirmText: 'Delete cycle' }))) return;
                  if ((await run(() => api(`/projects/${project.id}/cycles/${c.id}`, { method: 'DELETE' }), 'Cycle deleted')) !== undefined) {
                    void queryClient.invalidateQueries({ queryKey: ['cycles', project.id] });
                    navigate(`/p/${project.id}/execution`);
                  }
                }}
              >
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {summary && (
        <div className="card ai-card stack" style={{ marginBottom: 16 }}>
          <div className="row between">
            <h3 className="row">
              <Sparkles size={16} /> AI release readiness: <span className={`badge ${summary.readiness === 'ready' ? '' : 'danger'}`}>{READINESS[summary.readiness]}</span>
            </h3>
            <button type="button" className="btn ghost sm" onClick={() => setSummary(null)}>
              Dismiss
            </button>
          </div>
          <p className="pre">{summary.summary}</p>
          <div className="grid-2">
            <div>
              <span className="section-title">Risks</span>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {summary.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
            <div>
              <span className="section-title">Recommendations</span>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {summary.recommendations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="small muted">AI-generated assessment - verify before making release decisions.</p>
        </div>
      )}

      <div className="card stack" style={{ marginBottom: 16 }}>
        <div className="row between wrap">
          <strong>
            {c.counts.total - c.counts.not_run - c.counts.in_progress} of {c.counts.total} executed
          </strong>
          <span className="muted small">
            {c.counts.passed} passed · {c.counts.failed} failed · {c.counts.blocked} blocked
          </span>
        </div>
        <StatusStackBar counts={c.counts} large />
        <StatusLegend />
      </div>

      <div className="card flush">
        <div className="card-header">
          <h2>Test runs</h2>
          {can('lead') && !closed && (
            <div className="row wrap">
              <button type="button" className="btn sm" onClick={() => setAdding('folder')}>
                <FolderPlus size={14} /> Add folder
              </button>
              <button type="button" className="btn sm primary" onClick={() => setAdding('cases')}>
                <ListPlus size={14} /> Add test cases
              </button>
            </div>
          )}
        </div>
        <ErrorAlert error={runs.error} />
        {runs.isLoading ? (
          <Loading />
        ) : runs.data?.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Test case</th>
                  <th>Title</th>
                  <th>Priority</th>
                  <th>Assignee</th>
                  <th>Status</th>
                  <th>Executed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs.data.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <KeyBadge value={r.testCaseKey ?? ''} />
                    </td>
                    <td className="title-cell">
                      <div className="row">
                        {r.isAutomated && <Bot size={14} className="muted" aria-label="Automated" />}
                        <Link to={`/p/${project.id}/runs/${r.id}`} className="truncate">
                          {r.testCaseTitle}
                        </Link>
                        {r.outdated && (
                          <span className="badge" title="The test case changed after it was added to this cycle">
                            Updated
                          </span>
                        )}
                      </div>
                    </td>
                    <td>{r.priority && <PriorityBadge priority={r.priority} />}</td>
                    <td style={{ minWidth: 150 }}>
                      {can('lead') && !closed ? (
                        <MemberSelect
                          small
                          projectId={project.id}
                          value={r.assigneeId}
                          onChange={(assigneeId) => run(() => api(`/projects/${project.id}/runs/${r.id}`, { method: 'PATCH', body: { assigneeId } })).then(reload)}
                        />
                      ) : (
                        (r.assigneeName ?? <span className="muted">Unassigned</span>)
                      )}
                    </td>
                    <td>
                      <RunStatusBadge status={r.status} />
                    </td>
                    <td className="nowrap small muted">{formatDate(r.executedAt, true)}</td>
                    <td>
                      <div className="btn-group">
                        {can('tester') && !closed && (
                          <Link to={`/p/${project.id}/runs/${r.id}`} className="btn sm">
                            <PlayCircle size={14} /> Run
                          </Link>
                        )}
                        {can('lead') && !closed && (
                          <button
                            type="button"
                            className="btn ghost sm icon"
                            title="Remove from cycle"
                            onClick={async () => {
                              if (!(await confirm({ title: 'Remove run', message: `Remove ${r.testCaseKey} from this cycle? Its execution history is deleted.`, confirmText: 'Remove' }))) return;
                              await run(() => api(`/projects/${project.id}/runs/${r.id}`, { method: 'DELETE' }));
                              reload();
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={PlayCircle} title="No test runs in this cycle">
            {can('lead') ? 'Add test cases to start executing.' : undefined}
          </Empty>
        )}
      </div>

      {adding === 'cases' && (
        <TestCasePicker
          projectId={project.id}
          title="Add test cases to cycle"
          confirmText="Add to cycle"
          exclude={runs.data?.map((r) => r.testCaseId)}
          onClose={() => setAdding(null)}
          onPick={(ids) => addRuns({ testCaseIds: ids })}
        />
      )}
      {adding === 'folder' && <AddFolderModal projectId={project.id} onClose={() => setAdding(null)} onAdd={(folderId) => addRuns({ folderId })} />}
      {editing && (
        <PlanModal
          title="Edit test cycle"
          initial={{ name: c.name, description: c.description, startDate: c.startDate ?? '', endDate: c.endDate ?? '', status: c.status, releaseId: c.releaseId ?? '' }}
          releases={releases.data ?? []}
          onClose={() => setEditing(false)}
          onSubmit={async (f) => {
            if ((await run(() => api(`/projects/${project.id}/cycles/${c.id}`, { method: 'PATCH', body: planBody(f, true) }), 'Saved')) !== undefined) {
              setEditing(false);
              reload();
            }
          }}
        />
      )}
    </>
  );
}
