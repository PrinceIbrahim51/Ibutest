import { PRIORITIES, TEST_CASE_STATUSES, type Page, type TestCase } from '@ibutest/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, ClipboardList, Download, Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, downloadFile } from '../../api/client';
import { useAuth } from '../../auth/AuthProvider';
import { AiGenerateModal } from '../../components/AiGenerate';
import { FolderTree, type FolderSelection } from '../../components/FolderTree';
import { useProject } from '../../components/Layout';
import { Empty, ErrorAlert, KeyBadge, Loading, Pagination, PriorityBadge, StatusText, formatDate, label, useAction, useDebounced, useFeedback } from '../../components/ui';

export function TestCasesPage() {
  const { project, can } = useProject();
  const { status: authStatus } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const run = useAction();
  const { toast } = useFeedback();
  const [folder, setFolder] = useState<FolderSelection>('all');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [page, setPage] = useState(1);
  const [generating, setGenerating] = useState(false);
  const debounced = useDebounced(search);
  const params = { folderId: folder === 'all' ? undefined : (folder ?? undefined), search: debounced, status, priority, page };
  const query = useQuery({
    queryKey: ['testCases', project.id, params],
    queryFn: () => api<Page<TestCase>>(`/projects/${project.id}/test-cases`, { query: params }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Test cases</h1>
          <p className="subtitle">Design, version and approve reusable test cases.</p>
        </div>
        <div className="row wrap">
          <button type="button" className="btn" onClick={() => run(() => downloadFile(`/projects/${project.id}/reports/export/test-cases.csv`, 'test-cases.csv'))}>
            <Download size={16} /> Export CSV
          </button>
          {can('tester') && authStatus?.aiAvailable && project.aiEnabled && (
            <button type="button" className="btn ai" onClick={() => setGenerating(true)}>
              <Sparkles size={16} /> Generate with AI
            </button>
          )}
          {can('tester') && (
            <button
              type="button"
              className="btn primary"
              onClick={() => navigate(`/p/${project.id}/test-cases/new${folder !== 'all' && folder ? `?folderId=${folder}` : ''}`)}
            >
              <Plus size={16} /> New test case
            </button>
          )}
        </div>
      </div>
      <div className="split">
        <FolderTree projectId={project.id} kind="test_case" selected={folder} onSelect={(f) => (setFolder(f), setPage(1))} canEdit={can('tester')} canDelete={can('lead')} />
        <div className="card flush">
          <div className="card-header">
            <div className="toolbar" style={{ margin: 0, flex: 1 }}>
              <input className="input search" placeholder="Search title, key (TC-12) or automation key…" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} aria-label="Search test cases" />
              <select className="select" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Filter by status">
                <option value="">All statuses</option>
                {TEST_CASE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </select>
              <select className="select" value={priority} onChange={(e) => (setPriority(e.target.value), setPage(1))} aria-label="Filter by priority">
                <option value="">All priorities</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {label(p)}
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
                      <th>Priority</th>
                      <th>Status</th>
                      <th className="num">Steps</th>
                      <th className="num">Req.</th>
                      <th>Version</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.items.map((t) => (
                      <tr key={t.id} className="clickable" onClick={() => navigate(`/p/${project.id}/test-cases/${t.id}`)}>
                        <td>
                          <KeyBadge value={t.key} />
                        </td>
                        <td className="title-cell">
                          <div className="row">
                            {t.isAutomated && <Bot size={14} className="muted" aria-label="Automated" />}
                            <Link to={`/p/${project.id}/test-cases/${t.id}`} onClick={(e) => e.stopPropagation()} className="truncate">
                              {t.title}
                            </Link>
                          </div>
                        </td>
                        <td>
                          <PriorityBadge priority={t.priority} />
                        </td>
                        <td>
                          <StatusText value={t.status} />
                        </td>
                        <td className="num">{t.stepCount ?? 0}</td>
                        <td className={`num ${t.requirementCount ? '' : 'muted'}`}>{t.requirementCount ?? 0}</td>
                        <td className="mono">v{t.version}</td>
                        <td className="nowrap small muted">{formatDate(t.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={query.data.page} totalPages={query.data.totalPages} total={query.data.total} onPage={setPage} />
            </>
          ) : (
            <Empty icon={ClipboardList} title="No test cases found" />
          )}
        </div>
      </div>
      {generating && (
        <AiGenerateModal
          projectId={project.id}
          onClose={() => setGenerating(false)}
          onSaved={(n) => {
            setGenerating(false);
            toast(`${n} test case${n === 1 ? '' : 's'} created`);
            void queryClient.invalidateQueries({ queryKey: ['testCases', project.id] });
          }}
        />
      )}
    </>
  );
}
