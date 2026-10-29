import type { Folder, FolderKind } from '@ibutest/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Folder as FolderIcon, FolderOpen, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { api } from '../api/client';
import { Modal, useAction, useFeedback } from './ui';

export type FolderSelection = string | null | 'all';

interface Node extends Folder {
  children: Node[];
}

function buildTree(folders: Folder[]): Node[] {
  const byId = new Map<string, Node>(folders.map((f) => [f.id, { ...f, children: [] }]));
  const roots: Node[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

export function useFolders(projectId: string, kind: FolderKind) {
  return useQuery({
    queryKey: ['folders', projectId, kind],
    queryFn: () => api<{ items: Folder[] }>(`/projects/${projectId}/folders`, { query: { kind } }).then((r) => r.items),
  });
}

export function FolderSelect({ projectId, kind, value, onChange, id }: { projectId: string; kind: FolderKind; value: string | null; onChange: (v: string | null) => void; id?: string }) {
  const { data = [] } = useFolders(projectId, kind);
  const options = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    const walk = (nodes: Node[], depth: number) => {
      for (const n of [...nodes].sort((a, b) => a.name.localeCompare(b.name))) {
        out.push({ id: n.id, label: `${' '.repeat(depth)}${n.name}` });
        walk(n.children, depth + 1);
      }
    };
    walk(buildTree(data), 0);
    return out;
  }, [data]);
  return (
    <select id={id} className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">(No folder)</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function FolderTree({
  projectId,
  kind,
  selected,
  onSelect,
  canEdit,
  canDelete,
}: {
  projectId: string;
  kind: FolderKind;
  selected: FolderSelection;
  onSelect: (f: FolderSelection) => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const queryClient = useQueryClient();
  const { confirm } = useFeedback();
  const run = useAction();
  const { data = [] } = useFolders(projectId, kind);
  const tree = useMemo(() => buildTree(data), [data]);
  const [editing, setEditing] = useState<{ mode: 'create' | 'rename'; parentId: string | null; folder?: Folder } | null>(null);
  const [name, setName] = useState('');
  const reload = () => queryClient.invalidateQueries({ queryKey: ['folders', projectId, kind] });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const ok = await run(() =>
      editing.mode === 'create'
        ? api(`/projects/${projectId}/folders`, { method: 'POST', body: { kind, name, parentId: editing.parentId } })
        : api(`/projects/${projectId}/folders/${editing.folder!.id}`, { method: 'PATCH', body: { name } }),
    );
    if (ok !== undefined) {
      setEditing(null);
      void reload();
    }
  }

  async function remove(folder: Folder) {
    const yes = await confirm({
      title: 'Delete folder',
      message: `Delete "${folder.name}" and its sub-folders? Items inside are kept and moved to the top level.`,
      confirmText: 'Delete folder',
    });
    if (!yes) return;
    await run(() => api(`/projects/${projectId}/folders/${folder.id}`, { method: 'DELETE' }), 'Folder deleted');
    if (selected === folder.id) onSelect('all');
    void reload();
    void queryClient.invalidateQueries({ queryKey: [kind === 'test_case' ? 'testCases' : 'requirements', projectId] });
  }

  const renderNodes = (nodes: Node[]) => (
    <ul className="tree">
      {[...nodes]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((n) => (
          <li key={n.id}>
            <div className="tree-row">
              <button type="button" className={`tree-item${selected === n.id ? ' active' : ''}`} onClick={() => onSelect(n.id)}>
                {selected === n.id ? <FolderOpen size={15} aria-hidden /> : <FolderIcon size={15} aria-hidden />}
                <span className="truncate">{n.name}</span>
              </button>
              {canEdit && (
                <span className="tree-actions">
                  <button type="button" className="btn ghost sm icon" title="New sub-folder" onClick={() => (setName(''), setEditing({ mode: 'create', parentId: n.id }))}>
                    <Plus size={13} />
                  </button>
                  <button type="button" className="btn ghost sm icon" title="Rename" onClick={() => (setName(n.name), setEditing({ mode: 'rename', parentId: n.parentId, folder: n }))}>
                    <Pencil size={13} />
                  </button>
                  {canDelete && (
                    <button type="button" className="btn ghost sm icon" title="Delete" onClick={() => void remove(n)}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </span>
              )}
            </div>
            {n.children.length > 0 && renderNodes(n.children)}
          </li>
        ))}
    </ul>
  );

  return (
    <div className="card stack tight">
      <div className="row between">
        <span className="section-title">Folders</span>
        {canEdit && (
          <button type="button" className="btn ghost sm" onClick={() => (setName(''), setEditing({ mode: 'create', parentId: null }))}>
            <Plus size={14} /> Folder
          </button>
        )}
      </div>
      <button type="button" className={`tree-item${selected === 'all' ? ' active' : ''}`} onClick={() => onSelect('all')}>
        <Layers size={15} aria-hidden /> All items
      </button>
      {renderNodes(tree)}
      {editing && (
        <Modal title={editing.mode === 'create' ? 'New folder' : 'Rename folder'} onClose={() => setEditing(null)}>
          <form className="stack" onSubmit={save}>
            <div className="field">
              <label htmlFor="folder-name">Name</label>
              <input id="folder-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
            </div>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" className="btn primary">
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
