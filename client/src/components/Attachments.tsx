import { ATTACHMENT_MAX_BYTES, type Attachment, type AttachmentEntityType } from '@ibutest/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Paperclip, Trash2, Upload } from 'lucide-react';
import { useRef } from 'react';
import { api, downloadFile } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { formatDate, useAction, useFeedback } from './ui';

const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.log,.csv,.json,.zip,.mp4,.webm';

function size(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

export function Attachments({
  projectId,
  entityType,
  entityId,
  canUpload,
  canDeleteAny,
}: {
  projectId: string;
  entityType: AttachmentEntityType;
  entityId: string;
  canUpload: boolean;
  canDeleteAny: boolean;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const run = useAction();
  const input = useRef<HTMLInputElement>(null);
  const key = ['attachments', projectId, entityType, entityId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<{ items: Attachment[] }>(`/projects/${projectId}/attachments`, { query: { entityType, entityId } }).then((r) => r.items),
  });

  async function upload(file: File) {
    if (file.size > ATTACHMENT_MAX_BYTES) return toast('Files must be 10 MB or smaller', 'error');
    const form = new FormData();
    form.append('entityType', entityType);
    form.append('entityId', entityId);
    form.append('file', file);
    await run(() => api(`/projects/${projectId}/attachments`, { method: 'POST', body: form }), 'File attached');
    void queryClient.invalidateQueries({ queryKey: key });
  }

  return (
    <div className="card stack tight">
      <div className="row between">
        <span className="section-title row">
          <Paperclip size={13} /> Attachments
        </span>
        {canUpload && (
          <>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void upload(f);
              }}
            />
            <button type="button" className="btn sm" onClick={() => input.current?.click()}>
              <Upload size={14} /> Upload
            </button>
          </>
        )}
      </div>
      {query.data?.length ? (
        <ul className="stack tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {query.data.map((a) => (
            <li key={a.id} className="row">
              <div className="grow">
                <div className="truncate" title={a.fileName}>
                  {a.fileName}
                </div>
                <div className="small muted">
                  {size(a.sizeBytes)} · {a.uploadedByName ?? 'Unknown'} · {formatDate(a.createdAt)}
                </div>
              </div>
              <button
                type="button"
                className="btn ghost sm icon"
                title="Download"
                onClick={() => run(() => downloadFile(`/projects/${projectId}/attachments/${a.id}/download`, a.fileName))}
              >
                <Download size={14} />
              </button>
              {(canDeleteAny || (canUpload && a.uploadedBy === user?.id)) && (
                <button
                  type="button"
                  className="btn ghost sm icon"
                  title="Delete"
                  onClick={() =>
                    run(() => api(`/projects/${projectId}/attachments/${a.id}`, { method: 'DELETE' })).then(() =>
                      queryClient.invalidateQueries({ queryKey: key }),
                    )
                  }
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">No files attached.</p>
      )}
    </div>
  );
}
