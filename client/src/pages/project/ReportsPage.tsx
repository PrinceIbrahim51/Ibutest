import type { TraceabilityRow } from '@ibutest/shared';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, GitBranch } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, downloadFile } from '../../api/client';
import { useProject } from '../../components/Layout';
import { Empty, ErrorAlert, KeyBadge, Loading, RunStatusBadge, StatusText, useAction } from '../../components/ui';

export function ReportsPage() {
  const { project } = useProject();
  const run = useAction();
  const [filter, setFilter] = useState<'all' | 'uncovered' | 'failing'>('all');
  const query = useQuery({
    queryKey: ['trace', project.id],
    queryFn: () => api<{ items: TraceabilityRow[] }>(`/projects/${project.id}/reports/traceability`).then((r) => r.items),
  });
  const rows = useMemo(() => {
    const items = query.data ?? [];
    if (filter === 'uncovered') return items.filter((r) => r.testCases.length === 0);
    if (filter === 'failing') return items.filter((r) => r.testCases.some((t) => t.lastStatus === 'failed' || t.lastStatus === 'blocked'));
    return items;
  }, [query.data, filter]);
  const covered = (query.data ?? []).filter((r) => r.testCases.length > 0).length;
  const total = query.data?.length ?? 0;
  const exports = [
    { path: 'test-cases.csv', text: 'Test cases (with steps)' },
    { path: 'requirements.csv', text: 'Requirements' },
    { path: 'defects.csv', text: 'Defects' },
  ];

  return (
    <div className="stack loose">
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p className="subtitle">Traceability from requirements to test results, and data exports.</p>
        </div>
      </div>
      <div className="card stack">
        <h2 className="row">
          <FileSpreadsheet size={18} /> Exports
        </h2>
        <p className="small muted">CSV files open in Excel, Google Sheets or Numbers. Formula characters are neutralised for safety.</p>
        <div className="row wrap">
          {exports.map((e) => (
            <button key={e.path} type="button" className="btn" onClick={() => run(() => downloadFile(`/projects/${project.id}/reports/export/${e.path}`, `${project.key}-${e.path}`))}>
              <Download size={16} /> {e.text}
            </button>
          ))}
        </div>
      </div>
      <div className="card flush">
        <div className="card-header">
          <div className="stack tight">
            <h2 className="row">
              <GitBranch size={18} /> Traceability matrix
            </h2>
            <span className="small muted">
              {covered} of {total} requirements covered by at least one test case
            </span>
          </div>
          <select className="select" style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter requirements">
            <option value="all">All requirements</option>
            <option value="uncovered">Without test coverage</option>
            <option value="failing">With failing tests</option>
          </select>
        </div>
        <ErrorAlert error={query.error} />
        {query.isLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty icon={GitBranch} title="Nothing to show" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Requirement</th>
                  <th>Status</th>
                  <th>Test cases &amp; latest result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="title-cell">
                      <div className="row">
                        <KeyBadge value={r.key} />
                        <Link to={`/p/${project.id}/requirements/${r.id}`} className="truncate">
                          {r.title}
                        </Link>
                      </div>
                    </td>
                    <td>
                      <StatusText value={r.status} />
                    </td>
                    <td>
                      {r.testCases.length === 0 ? (
                        <span className="badge danger">Not covered</span>
                      ) : (
                        <div className="stack tight">
                          {r.testCases.map((t) => (
                            <div key={t.id} className="row wrap">
                              <KeyBadge value={t.key} />
                              <Link to={`/p/${project.id}/test-cases/${t.id}`} className="truncate" style={{ maxWidth: 320 }}>
                                {t.title}
                              </Link>
                              <RunStatusBadge status={t.lastStatus} />
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
