import {
  PRIORITIES,
  TEST_CASE_TYPES,
  type AiReview,
  type Priority,
  type TestCase,
  type TestCaseDetail,
  type TestCaseStatus,
  type TestCaseType,
  type TestCaseVersion,
} from '@ibutest/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Copy, History, Plus, Sparkles, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { api, errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { Attachments } from '../../components/Attachments';
import { FolderSelect } from '../../components/FolderTree';
import { useProject } from '../../components/Layout';
import { ErrorAlert, KeyBadge, Loading, Modal, RunStatusBadge, Spinner, StatusText, formatDate, label, useAction, useFeedback } from '../../components/ui';

interface StepForm {
  action: string;
  expected: string;
  testData: string;
}
interface CaseForm {
  title: string;
  description: string;
  preconditions: string;
  priority: Priority;
  status: TestCaseStatus;
  type: TestCaseType;
  folderId: string | null;
  automationKey: string;
  isAutomated: boolean;
  estimatedMinutes: string;
  tags: string;
  steps: StepForm[];
}

const blankStep = (): StepForm => ({ action: '', expected: '', testData: '' });

function toPayload(form: CaseForm, isNew: boolean) {
  return {
    title: form.title,
    description: form.description,
    preconditions: form.preconditions,
    priority: form.priority,
    ...(form.status !== 'approved' || isNew ? { status: form.status === 'approved' ? 'ready' : form.status } : {}),
    type: form.type,
    folderId: form.folderId,
    automationKey: form.automationKey.trim() || null,
    isAutomated: form.isAutomated,
    estimatedMinutes: form.estimatedMinutes === '' ? null : Math.max(0, Math.round(Number(form.estimatedMinutes))),
    tags: form.tags
      .split(/[,\s]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
    steps: form.steps.filter((s) => s.action.trim()).map((s) => ({ action: s.action, expected: s.expected, testData: s.testData })),
  };
}

function StepsEditor({ steps, onChange, disabled }: { steps: StepForm[]; onChange: (s: StepForm[]) => void; disabled: boolean }) {
  const update = (i: number, patch: Partial<StepForm>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...steps];
    const [item] = next.splice(i, 1);
    next.splice(i + d, 0, item!);
    onChange(next);
  };
  return (
    <div className="steps">
      {steps.map((s, i) => (
        <div key={i} className="step">
          <span className="step-num" aria-hidden>
            {i + 1}
          </span>
          <div className="field">
            <label htmlFor={`step-a-${i}`}>Action</label>
            <textarea id={`step-a-${i}`} className="textarea" rows={2} value={s.action} onChange={(e) => update(i, { action: e.target.value })} maxLength={4000} disabled={disabled} />
            <input className="input sm" placeholder="Test data (optional)" value={s.testData} onChange={(e) => update(i, { testData: e.target.value })} maxLength={2000} disabled={disabled} aria-label={`Test data for step ${i + 1}`} />
          </div>
          <div className="field">
            <label htmlFor={`step-e-${i}`}>Expected result</label>
            <textarea id={`step-e-${i}`} className="textarea" rows={2} value={s.expected} onChange={(e) => update(i, { expected: e.target.value })} maxLength={4000} disabled={disabled} />
          </div>
          {!disabled && (
            <div className="btn-group">
              <button type="button" className="btn ghost sm icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move step up">
                <ArrowUp size={14} />
              </button>
              <button type="button" className="btn ghost sm icon" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label="Move step down">
                <ArrowDown size={14} />
              </button>
              <button type="button" className="btn ghost sm icon" onClick={() => onChange(steps.filter((_, j) => j !== i))} aria-label="Remove step">
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>
      ))}
      {!disabled && (
        <button type="button" className="btn" onClick={() => onChange([...steps, blankStep()])}>
          <Plus size={16} /> Add step
        </button>
      )}
    </div>
  );
}

function VersionsModal({ projectId, testCaseId, onClose }: { projectId: string; testCaseId: string; onClose: () => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const versions = useQuery({
    queryKey: ['versions', projectId, testCaseId],
    queryFn: () => api<{ items: TestCaseVersion[] }>(`/projects/${projectId}/test-cases/${testCaseId}/versions`).then((r) => r.items),
  });
  const snapshot = useQuery({
    queryKey: ['version', projectId, testCaseId, selected],
    enabled: selected !== null,
    queryFn: () =>
      api<{ version: { snapshot: { title: string; preconditions: string; steps: StepForm[] } } }>(
        `/projects/${projectId}/test-cases/${testCaseId}/versions/${selected}`,
      ).then((r) => r.version.snapshot),
  });
  return (
    <Modal title="Version history" onClose={onClose} wide>
      <div className="split">
        <div className="stack tight">
          {versions.data?.map((v) => (
            <button key={v.version} type="button" className={`tree-item${selected === v.version ? ' active' : ''}`} onClick={() => setSelected(v.version)}>
              <strong>v{v.version}</strong>
              <span className="small muted truncate">
                {formatDate(v.createdAt, true)} · {v.changedByName ?? 'unknown'}
              </span>
            </button>
          ))}
        </div>
        <div>
          {selected === null ? (
            <p className="muted">Select a version to view its content.</p>
          ) : snapshot.isLoading ? (
            <Loading />
          ) : snapshot.data ? (
            <div className="stack">
              <h3>{snapshot.data.title}</h3>
              {snapshot.data.preconditions && <p className="pre text-2">Preconditions: {snapshot.data.preconditions}</p>}
              <ol className="stack tight" style={{ paddingLeft: 20, margin: 0 }}>
                {snapshot.data.steps.map((s, i) => (
                  <li key={i}>
                    <span className="pre">{s.action}</span>
                    {s.expected && <div className="muted pre">Expected: {s.expected}</div>}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

function AiReviewCard({ review, onClose }: { review: AiReview; onClose: () => void }) {
  return (
    <div className="card ai-card stack">
      <div className="row between">
        <h3 className="row">
          <Sparkles size={16} /> AI quality review
        </h3>
        <button type="button" className="btn ghost sm" onClick={onClose}>
          Dismiss
        </button>
      </div>
      <div className="row top">
        <div className="stack tight" style={{ alignItems: 'center', minWidth: 70 }}>
          <span className="score">{review.score}</span>
          <span className="small muted">/ 100</span>
        </div>
        <p className="pre text-2 grow">{review.summary}</p>
      </div>
      {review.issues.length > 0 && (
        <ul className="stack tight" style={{ margin: 0, paddingLeft: 18 }}>
          {review.issues.map((i, n) => (
            <li key={n}>
              <span className={`badge ${i.severity === 'high' ? 'danger' : ''}`}>{label(i.severity)}</span> <span className="small muted">{label(i.category)}</span>
              {i.stepNumber ? <span className="small muted"> · step {i.stepNumber}</span> : null}
              <div className="pre">{i.message}</div>
            </li>
          ))}
        </ul>
      )}
      {review.suggestedAdditionalTests.length > 0 && (
        <div className="stack tight">
          <span className="section-title">Ideas for more coverage</span>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {review.suggestedAdditionalTests.map((t, n) => (
              <li key={n}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="small muted">AI suggestions can be wrong - review before applying.</p>
    </div>
  );
}

function formFrom(detail: TestCaseDetail): CaseForm {
  const t = detail.testCase;
  return {
    title: t.title,
    description: t.description,
    preconditions: t.preconditions,
    priority: t.priority,
    status: t.status,
    type: t.type,
    folderId: t.folderId,
    automationKey: t.automationKey ?? '',
    isAutomated: t.isAutomated,
    estimatedMinutes: t.estimatedMinutes === null ? '' : String(t.estimatedMinutes),
    tags: t.tags.join(', '),
    steps: detail.steps.map((s) => ({ action: s.action, expected: s.expected, testData: s.testData })),
  };
}

export function TestCaseEditorPage() {
  const { project } = useProject();
  const { testCaseId } = useParams();
  const [searchParams] = useSearchParams();
  const query = useQuery({
    queryKey: ['testCase', project.id, testCaseId],
    enabled: !!testCaseId,
    queryFn: () => api<TestCaseDetail>(`/projects/${project.id}/test-cases/${testCaseId}`),
  });
  if (!testCaseId) {
    return (
      <TestCaseEditor
        initial={{
          title: '',
          description: '',
          preconditions: '',
          priority: 'medium',
          status: 'draft',
          type: 'functional',
          folderId: searchParams.get('folderId'),
          automationKey: '',
          isAutomated: false,
          estimatedMinutes: '',
          tags: '',
          steps: [blankStep()],
        }}
      />
    );
  }
  if (!query.data) return query.error ? <ErrorAlert error={query.error} /> : <Loading />;
  // Re-keying on updatedAt resets the form whenever the server copy changes.
  return <TestCaseEditor key={query.data.testCase.updatedAt} detail={query.data} initial={formFrom(query.data)} />;
}

function TestCaseEditor({ detail, initial }: { detail?: TestCaseDetail; initial: CaseForm }) {
  const { project, can } = useProject();
  const { status: authStatus } = useAuth();
  const isNew = !detail;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const run = useAction();
  const { confirm } = useFeedback();
  const [form, setForm] = useState<CaseForm>(initial);
  const [error, setError] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [review, setReview] = useState<AiReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const tc = detail?.testCase;
  const testCaseId = tc?.id;
  const key = ['testCase', project.id, testCaseId];
  const editable = can('tester');

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (isNew) {
        const res = await api<{ testCase: TestCase }>(`/projects/${project.id}/test-cases`, { method: 'POST', body: toPayload(form, true) });
        void queryClient.invalidateQueries({ queryKey: ['testCases', project.id] });
        navigate(`/p/${project.id}/test-cases/${res.testCase.id}`, { replace: true });
      } else {
        await api(`/projects/${project.id}/test-cases/${testCaseId}`, { method: 'PATCH', body: toPayload(form, false) });
        void queryClient.invalidateQueries({ queryKey: key });
        void queryClient.invalidateQueries({ queryKey: ['testCases', project.id] });
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function aiReview() {
    setReviewing(true);
    const res = await run(() => api<{ review: AiReview }>(`/projects/${project.id}/ai/review-test-case`, { method: 'POST', body: { testCaseId } }));
    setReviewing(false);
    if (res) setReview(res.review);
  }

  const set = <K extends keyof CaseForm>(k: K, v: CaseForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <>
      <div className="page-header">
        <div className="stack tight">
          <Link to={`/p/${project.id}/test-cases`} className="row small">
            <ArrowLeft size={14} /> Test cases
          </Link>
          <h1 className="row wrap">
            {tc && <KeyBadge value={tc.key} />} {isNew ? 'New test case' : tc?.title}
          </h1>
          {tc && (
            <p className="subtitle">
              Version {tc.version} · {label(tc.status)}
              {tc.approvedByName && ` · approved by ${tc.approvedByName} on ${formatDate(tc.approvedAt)}`}
            </p>
          )}
        </div>
        {tc && (
          <div className="row wrap">
            {editable && authStatus?.aiAvailable && project.aiEnabled && (
              <button type="button" className="btn ai" onClick={aiReview} disabled={reviewing}>
                {reviewing ? <Spinner /> : <Sparkles size={16} />} Review with AI
              </button>
            )}
            <button type="button" className="btn" onClick={() => setShowVersions(true)}>
              <History size={16} /> History
            </button>
            {editable && (
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  const res = await run(() => api<{ testCase: TestCase }>(`/projects/${project.id}/test-cases/${tc.id}/clone`, { method: 'POST' }), 'Test case cloned');
                  if (res) navigate(`/p/${project.id}/test-cases/${res.testCase.id}`);
                }}
              >
                <Copy size={16} /> Clone
              </button>
            )}
            {can('lead') && tc.status !== 'approved' && tc.status !== 'deprecated' && (
              <button
                type="button"
                className="btn primary"
                onClick={() => run(() => api(`/projects/${project.id}/test-cases/${tc.id}/approve`, { method: 'POST' }), 'Approved').then(() => queryClient.invalidateQueries({ queryKey: key }))}
              >
                <CheckCircle2 size={16} /> Approve
              </button>
            )}
            {can('lead') && (
              <button
                type="button"
                className="btn danger"
                onClick={async () => {
                  if (!(await confirm({ title: 'Delete test case', message: `Delete ${tc.key}? Its execution history in all cycles is deleted too. Consider marking it deprecated instead.`, confirmText: 'Delete' }))) return;
                  if ((await run(() => api(`/projects/${project.id}/test-cases/${tc.id}`, { method: 'DELETE' }), 'Deleted')) !== undefined) {
                    void queryClient.invalidateQueries({ queryKey: ['testCases', project.id] });
                    navigate(`/p/${project.id}/test-cases`);
                  }
                }}
              >
                <Trash2 size={16} /> Delete
              </button>
            )}
          </div>
        )}
      </div>
      {review && (
        <div style={{ marginBottom: 16 }}>
          <AiReviewCard review={review} onClose={() => setReview(null)} />
        </div>
      )}
      <div className="split detail">
        <form className="stack" onSubmit={save}>
          {error && <div className="alert error">{error}</div>}
          <fieldset disabled={!editable} className="stack" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            <div className="card stack">
              <div className="field">
                <label htmlFor="tc-title">Title</label>
                <input id="tc-title" className="input" value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={255} required />
              </div>
              <div className="field">
                <label htmlFor="tc-desc">Objective / description</label>
                <textarea id="tc-desc" className="textarea" value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={20000} />
              </div>
              <div className="field">
                <label htmlFor="tc-pre">Preconditions</label>
                <textarea id="tc-pre" className="textarea" rows={2} value={form.preconditions} onChange={(e) => set('preconditions', e.target.value)} maxLength={10000} />
              </div>
              <div className="grid-3">
                <div className="field">
                  <label htmlFor="tc-prio">Priority</label>
                  <select id="tc-prio" className="select" value={form.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {label(p)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="tc-type">Type</label>
                  <select id="tc-type" className="select" value={form.type} onChange={(e) => set('type', e.target.value as TestCaseType)}>
                    {TEST_CASE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {label(t)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="tc-status">Status</label>
                  <select id="tc-status" className="select" value={form.status} onChange={(e) => set('status', e.target.value as TestCaseStatus)}>
                    {form.status === 'approved' && <option value="approved">Approved</option>}
                    <option value="draft">Draft</option>
                    <option value="ready">Ready for review</option>
                    <option value="deprecated">Deprecated</option>
                  </select>
                </div>
              </div>
              <div className="grid-3">
                <div className="field">
                  <label htmlFor="tc-folder">Folder</label>
                  <FolderSelect id="tc-folder" projectId={project.id} kind="test_case" value={form.folderId} onChange={(v) => set('folderId', v)} />
                </div>
                <div className="field">
                  <label htmlFor="tc-est">Estimate (minutes)</label>
                  <input id="tc-est" className="input" type="number" min={0} max={10000} value={form.estimatedMinutes} onChange={(e) => set('estimatedMinutes', e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="tc-tags">Tags</label>
                  <input id="tc-tags" className="input" value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="smoke, checkout" />
                </div>
              </div>
              <div className="grid-2">
                <label className="checkbox">
                  <input type="checkbox" checked={form.isAutomated} onChange={(e) => set('isAutomated', e.target.checked)} /> Automated test
                </label>
                <div className="field">
                  <label htmlFor="tc-auto">Automation key</label>
                  <input id="tc-auto" className="input mono" value={form.automationKey} onChange={(e) => set('automationKey', e.target.value)} maxLength={255} placeholder="tests/login.spec.ts::signs in" />
                  <span className="hint">Matches results uploaded by CI through the automation API.</span>
                </div>
              </div>
            </div>
            <div className="card stack">
              <h2>Test steps</h2>
              <StepsEditor steps={form.steps} onChange={(steps) => set('steps', steps)} disabled={!editable} />
            </div>
          </fieldset>
          {editable && (
            <div className="form-actions">
              {tc?.status === 'approved' && <span className="small muted spacer">Saving content changes creates a new version that needs re-approval.</span>}
              <button type="submit" className="btn primary">
                {isNew ? 'Create test case' : 'Save changes'}
              </button>
            </div>
          )}
        </form>
        {tc && detail && (
          <div className="stack">
            <div className="card stack tight">
              <span className="section-title">Requirements</span>
              {detail.requirements.length === 0 ? (
                <p className="small muted">Not linked to a requirement.</p>
              ) : (
                detail.requirements.map((r) => (
                  <div key={r.id} className="row">
                    <KeyBadge value={r.key} />
                    <Link to={`/p/${project.id}/requirements/${r.id}`} className="truncate grow">
                      {r.title}
                    </Link>
                    <StatusText value={r.status} />
                  </div>
                ))
              )}
            </div>
            <div className="card stack tight">
              <span className="section-title">Recent runs</span>
              {detail.recentRuns.length === 0 ? (
                <p className="small muted">Never executed.</p>
              ) : (
                detail.recentRuns.map((r) => (
                  <div key={r.id} className="row">
                    <Link to={`/p/${project.id}/runs/${r.id}`} className="truncate grow">
                      {r.cycleName}
                    </Link>
                    <RunStatusBadge status={r.status} />
                  </div>
                ))
              )}
            </div>
            <Attachments projectId={project.id} entityType="test_case" entityId={tc.id} canUpload={editable} canDeleteAny={can('lead')} />
          </div>
        )}
      </div>
      {showVersions && tc && <VersionsModal projectId={project.id} testCaseId={tc.id} onClose={() => setShowVersions(false)} />}
    </>
  );
}
