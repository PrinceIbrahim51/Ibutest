import { DEFECT_SEVERITIES, type Dashboard } from '@ibutest/shared';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { ExecutionTrend, HBarList, StatusLegend, StatusStackBar } from '../../components/charts';
import { useProject } from '../../components/Layout';
import { Empty, ErrorAlert, Loading, formatDate, label } from '../../components/ui';

function pct(part: number, whole: number) {
  return whole ? Math.round((part / whole) * 100) : 0;
}

function StatTile({ title, value, sub, meter }: { title: string; value: number | string; sub?: string; meter?: number }) {
  return (
    <div className="card stat">
      <div className="label">{title}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
      {meter !== undefined && (
        <div className="meter" role="meter" aria-valuenow={meter} aria-valuemin={0} aria-valuemax={100} aria-label={title}>
          <span style={{ width: `${meter}%` }} />
        </div>
      )}
    </div>
  );
}

export function DashboardPage() {
  const { project } = useProject();
  const query = useQuery({
    queryKey: ['dashboard', project.id],
    queryFn: () => api<Dashboard>(`/projects/${project.id}/reports/dashboard`),
  });
  if (query.isLoading) return <Loading />;
  if (!query.data) return <ErrorAlert error={query.error} />;
  const d = query.data;
  const openDefects = Object.values(d.defects.openBySeverity).reduce((a, b) => a + (b ?? 0), 0);
  const coverage = pct(d.requirements.covered, d.requirements.total);
  const automation = pct(d.testCases.automated, d.testCases.total);

  return (
    <div className="stack loose">
      <div className="page-header">
        <div>
          <h1>{project.name}</h1>
          <p className="subtitle">{project.description || 'Project overview'}</p>
        </div>
      </div>

      <div className="stats">
        <StatTile title="Requirement coverage" value={`${coverage}%`} sub={`${d.requirements.covered} of ${d.requirements.total} requirements have tests`} meter={coverage} />
        <StatTile title="Test cases" value={d.testCases.total.toLocaleString()} sub={`${automation}% automated · ${d.testCases.byStatus.approved ?? 0} approved`} meter={automation} />
        <StatTile title="Open defects" value={openDefects} sub={`${(d.defects.openBySeverity.blocker ?? 0) + (d.defects.openBySeverity.critical ?? 0)} critical or blocker`} />
        <StatTile title="Active cycles" value={d.activeCycles.length} sub="Planned or in progress" />
      </div>

      <div className="grid-2">
        <div className="card stack">
          <div className="card-header" style={{ marginBottom: 0 }}>
            <h2>Active test cycles</h2>
            <Link to={`/p/${project.id}/execution`} className="small">
              All cycles
            </Link>
          </div>
          {d.activeCycles.length === 0 ? (
            <Empty title="No active cycles" />
          ) : (
            <>
              {d.activeCycles.map((c) => {
                const total = c.counts?.total ?? 0;
                const done = total - (c.counts?.not_run ?? 0) - (c.counts?.in_progress ?? 0);
                return (
                  <div key={c.id} className="stack tight">
                    <div className="row between">
                      <Link to={`/p/${project.id}/cycles/${c.id}`} className="truncate">
                        {c.name}
                      </Link>
                      <span className="small muted nowrap">
                        {done}/{total} executed · {pct(c.counts?.passed ?? 0, total)}% passed
                      </span>
                    </div>
                    <StatusStackBar counts={c.counts} />
                  </div>
                );
              })}
              <StatusLegend />
            </>
          )}
        </div>

        <div className="card stack">
          <h2>Open defects by severity</h2>
          {openDefects === 0 ? (
            <Empty title="No open defects" />
          ) : (
            <HBarList items={[...DEFECT_SEVERITIES].reverse().map((s) => ({ label: label(s), value: d.defects.openBySeverity[s] ?? 0 }))} />
          )}
        </div>
      </div>

      <div className="card stack">
        <h2>Executions over the last 14 days</h2>
        <ExecutionTrend rows={d.executionTrend} />
      </div>

      <div className="card stack">
        <h2 className="row">
          <Activity size={18} /> Recent activity
        </h2>
        {d.recentActivity.length === 0 ? (
          <Empty title="Nothing yet" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {d.recentActivity.map((a, i) => (
                  <tr key={i}>
                    <td className="nowrap small muted">{formatDate(a.createdAt, true)}</td>
                    <td>{a.actorEmail ?? 'System'}</td>
                    <td className="mono small">{a.action}</td>
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
