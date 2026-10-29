import type { Page, TestCase } from '@ibutest/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { KeyBadge, Loading, Modal, Pagination, PriorityBadge, StatusText, useDebounced } from './ui';

export function TestCasePicker({
  projectId,
  title,
  confirmText,
  exclude = [],
  onClose,
  onPick,
}: {
  projectId: string;
  title: string;
  confirmText: string;
  exclude?: string[];
  onClose: () => void;
  onPick: (ids: string[]) => Promise<void> | void;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const debounced = useDebounced(search);
  const query = useQuery({
    queryKey: ['testCases', projectId, 'picker', debounced, page],
    queryFn: () => api<Page<TestCase>>(`/projects/${projectId}/test-cases`, { query: { search: debounced, page, pageSize: 20 } }),
    placeholderData: keepPreviousData,
  });
  const excluded = new Set(exclude);
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <Modal
      wide
      title={title}
      onClose={onClose}
      footer={
        <>
          <span className="muted small spacer">{selected.size} selected</span>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={selected.size === 0 || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onPick([...selected]);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmText}
          </button>
        </>
      }
    >
      <div className="stack">
        <input className="input" placeholder="Search by title, key (TC-12) or automation key…" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} autoFocus />
        {query.isLoading ? (
          <Loading />
        ) : (
          <div className="card flush">
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {query.data?.items.map((t) => {
                    const disabled = excluded.has(t.id);
                    return (
                      <tr key={t.id} className={disabled ? '' : 'clickable'} onClick={() => !disabled && toggle(t.id)}>
                        <td>
                          <input type="checkbox" checked={disabled || selected.has(t.id)} disabled={disabled} onChange={() => toggle(t.id)} aria-label={`Select ${t.key}`} onClick={(e) => e.stopPropagation()} />
                        </td>
                        <td>
                          <KeyBadge value={t.key} />
                        </td>
                        <td className="title-cell">{t.title}</td>
                        <td>
                          <PriorityBadge priority={t.priority} />
                        </td>
                        <td>
                          <StatusText value={t.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {query.data && <Pagination page={query.data.page} totalPages={query.data.totalPages} total={query.data.total} onPage={setPage} />}
          </div>
        )}
      </div>
    </Modal>
  );
}
