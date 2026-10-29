import {
  DEFECT_SEVERITIES,
  DEFECT_STATUSES,
  PRIORITIES,
  type Defect,
  type DefectSeverity,
  type DefectStatus,
  type Page,
  type Priority,
} from '@ibutest/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bug, Download, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, downloadFile, errorMessage } from '../../api/client';
import { Attachments } from '../../components/Attachments';
import { useProject } from '../../components/Layout';
import { MemberSelect } from '../../components/MemberSelect';
import {
  DefectStatusBadge,
  Empty,
  ErrorAlert,
  KeyBadge,
  Loading,
  Modal,
  Pagination,
  PriorityBadge,
  SeverityBadge,
  formatDate,
  label,
  useAction,
  useDebounced,
  useFeedback,
} from '../../components/ui';

interface DefectForm {
  title: string;
  description: string;
  stepsToReproduce: string;
  expectedResult: string;
  actualResult: string;
  severity: DefectSeverity;
  priority: Priority;
  status: DefectStatus;
  assigneeId: string | null;
  environment: string;
  externalRef: string;
}

const EMPTY: DefectForm = {
  title: '',
  description: '',
  stepsToReproduce: '',
  expectedResult: '',
  actualResult: '',
  severity: 'major',
  priority: 'medium',
  status: 'new',
  assigneeId: null,
  environment: '',
  externalRef: '',
};

function DefectFields({ form, setForm, projectId, showStatus }: { form: DefectForm; setForm: (f: DefectForm) => void; projectId: string; showStatus: boolean }) {
  const text = (k: keyof DefectForm) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="d-title">Summary</label>
        <input id="d-title" className="input" value={form.title} onChange={text('title')} maxLength={255} required />
      </div>
      <div className={showStatus ? 'grid-3' : 'grid-2'}>
        <div className="field">
          <label htmlFor="d-sev">Severity</label>
          <select id="d-sev" className="select" value={form.severity} onChange={text('severity')}>
            {DEFECT_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="d-prio">Priority</label>
          <select id="d-prio" className="select" value={form.priority} onChange={text('priority')}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {label(p)}
              </option>
            ))}
          </select>
        </div>
        {showStatus && (
          <div className="field">
            <label htmlFor="d-status">Status</label>
            <select id="d-status" className="select" value={form.status} onChange={text('status')}>
              {DEFECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="grid-3">
        <div className="field">
          <label htmlFor="d-assignee">Assignee</label>
          <MemberSelect id="d-assignee" projectId={projectId} value={form.assigneeId} onChange={(assigneeId) => setForm({ ...form, assigneeId })} />
        </div>
        <div className="field">
          <label htmlFor="d-env">Environment</label>
          <input id="d-env" className="input" value={form.environment} onChange={text('environment')} maxLength={255} placeholder="e.g. staging, Chrome 141" />
        </div>
        <div className="field">
          <label htmlFor="d-ext">External reference</label>
          <input id="d-ext" className="input" value={form.externalRef} onChange={text('externalRef')} maxLength={100} placeholder="e.g. JIRA-456" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="d-steps">Steps to reproduce</label>
        <textarea id="d-steps" className="textarea" rows={4} value={form.stepsToReproduce} onChange={text('stepsToReproduce')} maxLength={20000} />
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="d-exp">Expected result</label>
          <textarea id="d-exp" className="textarea" rows={3} value={form.expectedResult} onChange={text('expectedResult')} maxLength={5000} />
        </div>
        <div className="field">
          <label htmlFor="d-act">Actual result</label>
          <textarea id="d-act" className="textarea" rows={3} value={form.actualResult} onChange={text('actualResult')} maxLength={5000} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="d-desc">Additional details</label>
        <textarea id="d-desc" className="textarea" rows={3} value={form.description} onChange={text('description')} maxLength={20000} />
      </div>
    </div>
  );
}

/** Create-defect dialog, also used from the run execution page (pre-filled, optionally by AI). */
export function DefectModal({
  initial,
  title,
  onClose,
  onSaved,
}: {
  initial: Partial<DefectForm> & { testRunId?: string; testCaseId?: string };
  title: string;
  onClose: () => void;
  onSaved: (d: Defect) => void;
}) {
  const { project } = useProject();
  const queryClient = useQueryClient();
  const { testRunId, testCaseId, ...rest } = initial;
  const [form, setForm] = useState<DefectForm>({ ...EMPTY, ...rest });
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await api<{ defect: Defect }>(`/projects/${project.id}/defects`, {
        method: 'POST',
        body: { ...form, testRunId: testRunId ?? null, testCaseId: testCaseId ?? null },
      });
      void queryClient.invalidateQueries({ queryKey: ['defects', project.id] });
      onSaved(res.defect);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Modal title={title} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        {error && <div className="alert error">{error}</div>}
        <DefectFields form={form} setForm={setForm} projectId={project.id} showStatus={false} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Create defect
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function DefectsPage() {
  const { project, can } = useProject();
  const navigate = useNavigate();
  const run = useAction();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(search);
  const params = { search: debounced, status, severity, page };
  const query = useQuery({
    queryKey: ['defects', project.id, params],
    queryFn: () => api<Page<Defect>>(`/projects/${project.id}/defects`, { query: params }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Defects</h1>
          <p className="subtitle">Track bugs found during testing through to resolution.</p>
        </div>
        <div className="row wrap">
          <button type="button" className="btn" onClick={() => run(() => downloadFile(`/projects/${project.id}/reports/export/defects.csv`, 'defects.csv'))}>
            <Download size={16} /> Export CSV
          </button>
          {can('tester') && (
            <button type="button" className="btn primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> New defect
            </button>
          )}
        </div>
      </div>
      <div className="card flush">
        <div className="card-header">
          <div className="toolbar" style={{ margin: 0, flex: 1 }}>
            <input className="input search" placeholder="Search summary or key (DF-7)…" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} aria-label="Search defects" />
            <select className="select" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Filter by status">
              <option value="">All statuses</option>
              {DEFECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
            <select className="select" value={severity} onChange={(e) => (setSeverity(e.target.value), setPage(1))} aria-label="Filter by severity">
              <option value="">All severities</option>
              {DEFECT_SEVERITIES.map((s) => (
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
                    <th>Summary</th>
                    <th>Severity</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Assignee</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((d) => (
                    <tr key={d.id} className="clickable" onClick={() => navigate(`/p/${project.id}/defects/${d.id}`)}>
                      <td>
                        <KeyBadge value={d.key} />
                      </td>
                      <td className="title-cell">
                        <Link to={`/p/${project.id}/defects/${d.id}`} onClick={(e) => e.stopPropagation()}>
                          {d.title}
                        </Link>
                      </td>
                      <td>
                        <SeverityBadge severity={d.severity} />
                      </td>
                      <td>
                        <PriorityBadge priority={d.priority} />
                      </td>
                      <td>
                        <DefectStatusBadge status={d.status} />
                      </td>
                      <td>{d.assigneeName ?? <span className="muted">Unassigned</span>}</td>
                      <td className="nowrap small muted">{formatDate(d.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={query.data.page} totalPages={query.data.totalPages} total={query.data.total} onPage={setPage} />
          </>
        ) : (
          <Empty icon={Bug} title="No defects found" />
        )}
      </div>
      {creating && <DefectModal initial={{}} title="New defect" onClose={() => setCreating(false)} onSaved={(d) => navigate(`/p/${project.id}/defects/${d.id}`)} />}
    </>
  );
}

export function DefectDetailPage() {
  const { project, can } = useProject();
  const { defectId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const run = useAction();
  const { confirm } = useFeedback();
  const key = ['defect', project.id, defectId];
  const query = useQuery({ queryKey: key, queryFn: () => api<{ defect: Defect }>(`/projects/${project.id}/defects/${defectId}`).then((r) => r.defect) });
  const [form, setForm] = useState<DefectForm | null>(null);
  useEffect(() => {
    const d = query.data;
    if (d)
      setForm({
        title: d.title,
        description: d.description,
        stepsToReproduce: d.stepsToReproduce,
        expectedResult: d.expectedResult,
        actualResult: d.actualResult,
        severity: d.severity,
        priority: d.priority,
        status: d.status,
        assigneeId: d.assigneeId,
        environment: d.environment,
        externalRef: d.externalRef,
      });
  }, [query.data]);
  if (query.isLoading || !form) return query.error ? <ErrorAlert error={query.error} /> : <Loading />;
  const d = query.data!;
  const editable = can('tester');
  return (
    <>
      <div className="page-header">
        <div className="stack tight">
          <Link to={`/p/${project.id}/defects`} className="row small">
            <ArrowLeft size={14} /> Defects
          </Link>
          <h1 className="row wrap">
            <KeyBadge value={d.key} /> {d.title}
          </h1>
          <p className="subtitle">
            Reported by {d.reporterName ?? 'unknown'} on {formatDate(d.createdAt, true)}
            {d.resolvedAt && ` · resolved ${formatDate(d.resolvedAt)}`}
          </p>
        </div>
        {can('lead') && (
          <button
            type="button"
            className="btn danger"
            onClick={async () => {
              if (!(await confirm({ title: 'Delete defect', message: `Delete ${d.key}?`, confirmText: 'Delete' }))) return;
              if ((await run(() => api(`/projects/${project.id}/defects/${d.id}`, { method: 'DELETE' }), 'Defect deleted')) !== undefined) {
                void queryClient.invalidateQueries({ queryKey: ['defects', project.id] });
                navigate(`/p/${project.id}/defects`);
              }
            }}
          >
            <Trash2 size={16} /> Delete
          </button>
        )}
      </div>
      <div className="split detail">
        <form
          className="card stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if ((await run(() => api(`/projects/${project.id}/defects/${d.id}`, { method: 'PATCH', body: form }), 'Saved')) !== undefined) {
              void queryClient.invalidateQueries({ queryKey: key });
              void queryClient.invalidateQueries({ queryKey: ['defects', project.id] });
            }
          }}
        >
          <fieldset disabled={!editable} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            <DefectFields form={form} setForm={setForm} projectId={project.id} showStatus />
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
            <span className="section-title">Traceability</span>
            {d.testCaseId ? (
              <div className="row">
                <KeyBadge value={d.testCaseKey ?? 'TC'} />
                <Link to={`/p/${project.id}/test-cases/${d.testCaseId}`} className="truncate">
                  {d.testCaseTitle}
                </Link>
              </div>
            ) : (
              <p className="small muted">Not linked to a test case.</p>
            )}
            {d.testRunId && (
              <Link to={`/p/${project.id}/runs/${d.testRunId}`} className="small">
                Open the test run where it was found
              </Link>
            )}
          </div>
          <Attachments projectId={project.id} entityType="defect" entityId={d.id} canUpload={editable} canDeleteAny={can('lead')} />
        </div>
      </div>
    </>
  );
}
