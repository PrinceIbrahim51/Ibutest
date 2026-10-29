import { AI_FOCUS_AREAS, type AiGeneratedTestCase, type TestCase } from '@ibutest/shared';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '../api/client';
import { FolderSelect } from './FolderTree';
import { Modal, PriorityBadge, Spinner, StatusText, label } from './ui';

/**
 * AI-assisted test design (comparable to qTest Copilot): drafts are generated server-side
 * and only saved after a person reviews and selects them.
 */
export function AiGenerateModal({
  projectId,
  requirementId,
  requirementTitle,
  onClose,
  onSaved,
}: {
  projectId: string;
  requirementId?: string;
  requirementTitle?: string;
  onClose: () => void;
  onSaved: (count: number) => void;
}) {
  const [count, setCount] = useState(5);
  const [focus, setFocus] = useState<string[]>(['positive', 'negative', 'boundary']);
  const [notes, setNotes] = useState('');
  const [drafts, setDrafts] = useState<AiGeneratedTestCase[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<number | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'generate' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy('generate');
    setError(null);
    try {
      const res = await api<{ testCases: AiGeneratedTestCase[] }>(`/projects/${projectId}/ai/generate-test-cases`, {
        method: 'POST',
        body: { ...(requirementId ? { requirementId } : {}), ...(notes.trim() ? { text: notes } : {}), count, focus },
      });
      setDrafts(res.testCases);
      setSelected(new Set(res.testCases.map((_, i) => i)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!drafts) return;
    setBusy('save');
    setError(null);
    try {
      const ids: string[] = [];
      for (const i of [...selected].sort((a, b) => a - b)) {
        const d = drafts[i]!;
        const res = await api<{ testCase: TestCase }>(`/projects/${projectId}/test-cases`, {
          method: 'POST',
          body: { title: d.title, description: d.description, preconditions: d.preconditions, priority: d.priority, type: d.type, folderId, tags: ['ai-generated'], steps: d.steps },
        });
        ids.push(res.testCase.id);
      }
      if (requirementId && ids.length) {
        await api(`/projects/${projectId}/requirements/${requirementId}/links`, { method: 'POST', body: { testCaseIds: ids } });
      }
      onSaved(ids.length);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  }

  return (
    <Modal
      wide
      title={
        <span className="row">
          <Sparkles size={18} /> Generate test cases with AI
        </span>
      }
      onClose={onClose}
      footer={
        drafts ? (
          <>
            <button type="button" className="btn" onClick={() => setDrafts(null)} disabled={!!busy}>
              Back
            </button>
            <button type="button" className="btn primary" onClick={save} disabled={selected.size === 0 || !!busy}>
              {busy === 'save' ? 'Saving…' : `Save ${selected.size} test case${selected.size === 1 ? '' : 's'}`}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn ai" onClick={generate} disabled={!!busy || (!requirementId && notes.trim().length < 10)}>
              {busy === 'generate' ? <Spinner label="Generating" /> : <Sparkles size={16} />} {busy === 'generate' ? 'Generating…' : 'Generate'}
            </button>
          </>
        )
      }
    >
      <div className="stack">
        {error && <div className="alert error">{error}</div>}
        {!drafts ? (
          <>
            {requirementTitle && (
              <div className="alert info">
                Source requirement: <strong>{requirementTitle}</strong>
              </div>
            )}
            <div className="grid-2">
              <div className="field">
                <label htmlFor="ai-count">Number of test cases</label>
                <input id="ai-count" className="input" type="number" min={1} max={10} value={count} onChange={(e) => setCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
              </div>
              <div className="field">
                <span className="field-label">Focus</span>
                <div className="row wrap">
                  {AI_FOCUS_AREAS.map((f) => (
                    <label key={f} className="checkbox">
                      <input
                        type="checkbox"
                        checked={focus.includes(f)}
                        onChange={(e) => setFocus((cur) => (e.target.checked ? [...cur, f] : cur.filter((x) => x !== f)))}
                      />
                      {label(f)}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="field">
              <label htmlFor="ai-notes">{requirementId ? 'Additional context (optional)' : 'Describe the feature or requirement to test'}</label>
              <textarea id="ai-notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={20000} placeholder="Acceptance criteria, business rules, edge cases to consider…" />
            </div>
            <p className="small muted">
              Content is sent to the AI provider configured by your administrator. Nothing is saved until you review and accept the drafts.
            </p>
          </>
        ) : (
          <>
            <div className="row between wrap">
              <span className="text-2">Review the drafts and select the ones to keep.</span>
              <div className="field" style={{ minWidth: 220 }}>
                <FolderSelect projectId={projectId} kind="test_case" value={folderId} onChange={setFolderId} />
              </div>
            </div>
            {drafts.map((d, i) => (
              <div key={i} className="card stack tight">
                <div className="row top">
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    aria-label={`Keep ${d.title}`}
                    onChange={(e) =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(i);
                        else n.delete(i);
                        return n;
                      })
                    }
                  />
                  <button type="button" className="btn ghost sm icon" onClick={() => setExpanded(expanded === i ? null : i)} aria-label="Toggle steps">
                    {expanded === i ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <div className="grow stack tight">
                    <input
                      className="input"
                      value={d.title}
                      maxLength={255}
                      aria-label="Title"
                      onChange={(e) => setDrafts((all) => all!.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                    />
                    <div className="row wrap small">
                      <PriorityBadge priority={d.priority} />
                      <StatusText value={d.type} />
                      <span className="muted">{d.steps.length} steps</span>
                    </div>
                  </div>
                </div>
                {expanded === i && (
                  <div className="stack tight small">
                    {d.description && <p className="pre text-2">{d.description}</p>}
                    {d.preconditions && (
                      <p className="pre">
                        <strong>Preconditions:</strong> {d.preconditions}
                      </p>
                    )}
                    <ol className="stack tight" style={{ margin: 0, paddingLeft: 20 }}>
                      {d.steps.map((s, j) => (
                        <li key={j}>
                          <span className="pre">{s.action}</span>
                          {s.testData && <span className="muted"> - data: {s.testData}</span>}
                          {s.expected && <div className="muted pre">Expected: {s.expected}</div>}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}
