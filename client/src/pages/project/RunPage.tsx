import type { AiDefectDraft, ExecutionStatus, RunDetail, StepStatus } from '@ibutest/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Bug, CheckCircle2, ChevronDown, ChevronRight, MinusCircle, Sparkles, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { Attachments } from '../../components/Attachments';
import { useProject } from '../../components/Layout';
import { DefectStatusBadge, ErrorAlert, KeyBadge, Loading, RunStatusBadge, SeverityBadge, Spinner, formatDate, formatDuration, useAction, useFeedback } from '../../components/ui';
import { DefectModal } from './DefectsPage';

const STEP_BUTTONS: { status: StepStatus; text: string; icon: typeof CheckCircle2 }[] = [
  { status: 'passed', text: 'Pass', icon: CheckCircle2 },
  { status: 'failed', text: 'Fail', icon: XCircle },
  { status: 'blocked', text: 'Block', icon: AlertTriangle },
  { status: 'skipped', text: 'Skip', icon: MinusCircle },
];

function deriveStatus(statuses: StepStatus[]): ExecutionStatus {
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('blocked')) return 'blocked';
  if (statuses.length && statuses.every((s) => s === 'passed' || s === 'skipped')) return statuses.every((s) => s === 'skipped') ? 'skipped' : 'passed';
  return 'in_progress';
}

export function RunPage() {
  const { project } = useProject();
  const { runId = '' } = useParams();
  const query = useQuery({ queryKey: ['run', project.id, runId], queryFn: () => api<RunDetail>(`/projects/${project.id}/runs/${runId}`) });
  if (!query.data) return query.error ? <ErrorAlert error={query.error} /> : <Loading />;
  // A fresh execution form per run (and after the test case's steps change).
  return <RunExecution key={`${query.data.run.id}:${query.data.steps.length}`} detail={query.data} />;
}

function RunExecution({ detail: d }: { detail: RunDetail }) {
  const { project, can } = useProject();
  const { status: authStatus } = useAuth();
  const queryClient = useQueryClient();
  const run = useAction();
  const { toast } = useFeedback();
  const runId = d.run.id;
  const key = ['run', project.id, runId];
  const [results, setResults] = useState<{ status: StepStatus; actual: string }[]>(() => d.steps.map(() => ({ status: 'not_run', actual: '' })));
  const [overall, setOverall] = useState<ExecutionStatus | null>(null);
  const [comment, setComment] = useState('');
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defect, setDefect] = useState<Partial<AiDefectDraft> | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [openLog, setOpenLog] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const suggested = useMemo(() => deriveStatus(results.map((r) => r.status)), [results]);
  const closed = d.cycle.status === 'closed';
  const canExecute = can('tester') && !closed;
  const finalStatus = overall ?? suggested;
  const elapsed = Math.round((now - startedAt) / 1000);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api(`/projects/${project.id}/runs/${runId}/execute`, {
        method: 'POST',
        body: {
          status: finalStatus,
          comment,
          durationSeconds: elapsed,
          stepResults: results.map((r, position) => ({ position, status: r.status, actual: r.actual })).filter((r) => r.status !== 'not_run' || r.actual),
        },
      });
      toast(`Result saved: ${finalStatus.replace('_', ' ')}`);
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ['runs', project.id, d.cycle.id] });
      void queryClient.invalidateQueries({ queryKey: ['cycle', project.id, d.cycle.id] });
      if (finalStatus === 'failed' || finalStatus === 'blocked') {
        const failedStep = results.findIndex((r) => r.status === 'failed' || r.status === 'blocked');
        const step = failedStep >= 0 ? d.steps[failedStep] : undefined;
        setDefect({
          title: `${d.testCase.title} - ${finalStatus}`,
          stepsToReproduce: d.steps.map((s, i) => `${i + 1}. ${s.action}`).join('\n'),
          expectedResult: step?.expected ?? '',
          actualResult: results[failedStep]?.actual || comment,
        });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function aiDraft() {
    setDrafting(true);
    const res = await run(() => api<{ defect: AiDefectDraft }>(`/projects/${project.id}/ai/draft-defect`, { method: 'POST', body: { testRunId: runId } }));
    setDrafting(false);
    if (res) setDefect(res.defect);
  }

  return (
    <>
      <div className="page-header">
        <div className="stack tight">
          <Link to={`/p/${project.id}/cycles/${d.cycle.id}`} className="row small">
            <ArrowLeft size={14} /> {d.cycle.name}
          </Link>
          <h1 className="row wrap">
            <KeyBadge value={d.testCase.key} /> {d.testCase.title}
          </h1>
          <div className="row wrap small">
            <RunStatusBadge status={d.run.status} />
            <span className="muted">
              Last executed {formatDate(d.run.executedAt, true)} · test case v{d.testCase.version}
            </span>
            {d.run.testCaseVersion !== d.testCase.version && <span className="badge">Test case updated since it was planned (v{d.run.testCaseVersion})</span>}
          </div>
        </div>
        <div className="row wrap">
          {can('tester') && authStatus?.aiAvailable && project.aiEnabled && (d.run.status === 'failed' || d.run.status === 'blocked') && (
            <button type="button" className="btn ai" onClick={aiDraft} disabled={drafting}>
              {drafting ? <Spinner /> : <Sparkles size={16} />} Draft defect with AI
            </button>
          )}
          {can('tester') && (
            <button type="button" className="btn" onClick={() => setDefect({ title: `${d.testCase.title} - failure` })}>
              <Bug size={16} /> Report defect
            </button>
          )}
        </div>
      </div>
      {closed && <div className="alert warning" style={{ marginBottom: 16 }}>This test cycle is closed; results can no longer be recorded.</div>}

      <div className="split detail">
        <div className="stack">
          {(d.testCase.description || d.testCase.preconditions) && (
            <div className="card stack tight">
              {d.testCase.description && <p className="pre">{d.testCase.description}</p>}
              {d.testCase.preconditions && (
                <p className="pre">
                  <strong>Preconditions:</strong> {d.testCase.preconditions}
                </p>
              )}
            </div>
          )}
          <div className="steps">
            {d.steps.length === 0 && <div className="card muted">This test case has no steps - record the overall result below.</div>}
            {d.steps.map((s, i) => {
              const r = results[i] ?? { status: 'not_run' as StepStatus, actual: '' };
              return (
                <div key={s.id ?? i} className={`step exec ${r.status}`}>
                  <span className="step-num">{i + 1}</span>
                  <div className="stack tight">
                    <span className="field-label">Action</span>
                    <span className="pre">{s.action}</span>
                    {s.testData && <span className="small muted pre">Data: {s.testData}</span>}
                  </div>
                  <div className="stack tight">
                    <span className="field-label">Expected</span>
                    <span className="pre">{s.expected || '-'}</span>
                  </div>
                  <div className="stack tight">
                    <div className="status-picker" role="group" aria-label={`Result of step ${i + 1}`}>
                      {STEP_BUTTONS.map((b) => (
                        <button
                          key={b.status}
                          type="button"
                          className={`btn sm${r.status === b.status ? ` on-${b.status}` : ''}`}
                          aria-pressed={r.status === b.status}
                          disabled={!canExecute}
                          onClick={() => setResults((all) => all.map((x, j) => (j === i ? { ...x, status: x.status === b.status ? 'not_run' : b.status } : x)))}
                        >
                          <b.icon size={13} /> {b.text}
                        </button>
                      ))}
                    </div>
                    {(r.status === 'failed' || r.status === 'blocked' || r.actual) && (
                      <textarea
                        className="textarea"
                        rows={2}
                        placeholder="Actual result"
                        value={r.actual}
                        maxLength={4000}
                        disabled={!canExecute}
                        onChange={(e) => setResults((all) => all.map((x, j) => (j === i ? { ...x, actual: e.target.value } : x)))}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {canExecute && (
            <div className="card stack">
              {error && <div className="alert error">{error}</div>}
              <div className="row wrap between">
                <div className="field" style={{ minWidth: 0 }}>
                  <span className="field-label">Overall result</span>
                  <div className="status-picker">
                    {(['passed', 'failed', 'blocked', 'skipped', 'in_progress'] as ExecutionStatus[]).map((s) => (
                      <button key={s} type="button" className={`btn sm${finalStatus === s ? ` on-${s}` : ''}`} aria-pressed={finalStatus === s} onClick={() => setOverall(s)}>
                        {s === 'in_progress' ? 'In progress' : s[0]!.toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                  </div>
                  {overall === null && <span className="hint">Suggested from step results.</span>}
                </div>
                <div className="stack tight" style={{ alignItems: 'flex-end' }}>
                  <span className="field-label">Elapsed</span>
                  <span className="timer">{formatDuration(elapsed)}</span>
                </div>
              </div>
              <div className="field">
                <label htmlFor="run-comment">Comment</label>
                <textarea id="run-comment" className="textarea" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={10000} placeholder="Environment, build number, observations…" />
              </div>
              <div className="form-actions">
                <button type="button" className="btn primary" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Save result'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="stack">
          <div className="card stack tight">
            <span className="section-title">Defects</span>
            {d.defects.length === 0 ? (
              <p className="small muted">No defects linked to this run.</p>
            ) : (
              d.defects.map((df) => (
                <div key={df.id} className="row wrap">
                  <KeyBadge value={df.key} />
                  <Link to={`/p/${project.id}/defects/${df.id}`} className="grow truncate">
                    {df.title}
                  </Link>
                  <SeverityBadge severity={df.severity} />
                  <DefectStatusBadge status={df.status} />
                </div>
              ))
            )}
          </div>
          <div className="card stack tight">
            <span className="section-title">Execution history</span>
            {d.logs.length === 0 ? (
              <p className="small muted">Not executed yet.</p>
            ) : (
              d.logs.map((l) => (
                <div key={l.id} className="stack tight">
                  <button type="button" className="tree-item" onClick={() => setOpenLog(openLog === l.id ? null : l.id)} aria-expanded={openLog === l.id}>
                    {openLog === l.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <RunStatusBadge status={l.status} />
                    <span className="small muted truncate">
                      {formatDate(l.executedAt, true)} · {l.source === 'automation' ? 'automation' : (l.executedByName ?? 'unknown')}
                    </span>
                  </button>
                  {openLog === l.id && (
                    <div className="stack tight small" style={{ paddingLeft: 26 }}>
                      {l.durationSeconds !== null && <span className="muted">Duration: {formatDuration(l.durationSeconds)}</span>}
                      {l.comment && <span className="pre">{l.comment}</span>}
                      {l.stepResults
                        .filter((s) => s.status !== 'not_run' || s.actual)
                        .map((s) => (
                          <span key={s.position} className="pre">
                            Step {s.position + 1}: {s.status}
                            {s.actual ? ` - ${s.actual}` : ''}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <Attachments projectId={project.id} entityType="test_run" entityId={d.run.id} canUpload={can('tester')} canDeleteAny={can('lead')} />
        </div>
      </div>
      {defect && (
        <DefectModal
          initial={{ ...defect, testRunId: d.run.id }}
          title="Report defect"
          onClose={() => setDefect(null)}
          onSaved={() => {
            setDefect(null);
            void queryClient.invalidateQueries({ queryKey: key });
          }}
        />
      )}
    </>
  );
}
