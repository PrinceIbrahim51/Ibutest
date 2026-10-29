import type { Member } from '@ibutest/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export function useMembers(projectId: string) {
  return useQuery({
    queryKey: ['members', projectId],
    queryFn: () => api<{ items: Member[] }>(`/projects/${projectId}/members`).then((r) => r.items),
    staleTime: 60_000,
  });
}

export function MemberSelect({
  projectId,
  value,
  onChange,
  id,
  small,
  disabled,
  emptyLabel = 'Unassigned',
}: {
  projectId: string;
  value: string | null;
  onChange: (userId: string | null) => void;
  id?: string;
  small?: boolean;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  const { data = [] } = useMembers(projectId);
  return (
    <select id={id} className={`select${small ? ' sm' : ''}`} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel}</option>
      {data
        .filter((m) => m.isActive)
        .map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name}
          </option>
        ))}
    </select>
  );
}
