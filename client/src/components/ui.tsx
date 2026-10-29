import type { DefectSeverity, DefectStatus, Priority, RunStatus } from '@ibutest/shared';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Circle,
  CircleDashed,
  Loader2,
  type LucideIcon,
  MinusCircle,
  X,
  XCircle,
} from 'lucide-react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { errorMessage } from '../api/client';

export const label = (value: string) => value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function Spinner({ label: text = 'Loading' }: { label?: string }) {
  return <div className="spinner" role="status" aria-label={text} />;
}

export function Loading() {
  return (
    <div className="center-fill">
      <Spinner />
    </div>
  );
}

export function Empty({ icon: Icon, title, children }: { icon?: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {Icon && <Icon size={32} aria-hidden />}
      <div className="text-2">{title}</div>
      {children && <div className="small" style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="alert error" role="alert">
      {errorMessage(error)}
    </div>
  );
}

// ------------------------------------------------------------------ status badges

export const RUN_STATUS_META: Record<RunStatus, { icon: LucideIcon; text: string }> = {
  passed: { icon: CheckCircle2, text: 'Passed' },
  failed: { icon: XCircle, text: 'Failed' },
  blocked: { icon: AlertTriangle, text: 'Blocked' },
  in_progress: { icon: Loader2, text: 'In progress' },
  skipped: { icon: MinusCircle, text: 'Skipped' },
  not_run: { icon: CircleDashed, text: 'Not run' },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const meta = RUN_STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className="badge">
      <Icon size={13} className={`status-icon st-${status}`} aria-hidden />
      {meta.text}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`badge prio-${priority}`}>{label(priority)}</span>;
}

export function SeverityBadge({ severity }: { severity: DefectSeverity }) {
  const Icon = severity === 'blocker' ? Ban : severity === 'critical' ? XCircle : severity === 'major' ? AlertTriangle : Circle;
  return (
    <span className={`badge sev-${severity}`}>
      <Icon size={12} aria-hidden />
      {label(severity)}
    </span>
  );
}

export function DefectStatusBadge({ status }: { status: DefectStatus }) {
  const done = status === 'resolved' || status === 'closed';
  return <span className={`badge ${done ? '' : 'accent'}`}>{label(status)}</span>;
}

export function StatusText({ value }: { value: string }) {
  return <span className="badge">{label(value)}</span>;
}

export function KeyBadge({ value }: { value: string }) {
  return <span className="badge key">{value}</span>;
}

// ------------------------------------------------------------------ modal

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = dialogRef.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-close)');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn ghost icon modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ toasts & confirm

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}
interface ConfirmRequest {
  title: string;
  message: ReactNode;
  confirmText: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

const FeedbackContext = createContext<{
  toast: (text: string, kind?: 'info' | 'error') => void;
  confirm: (opts: { title: string; message: ReactNode; confirmText?: string; danger?: boolean }) => Promise<boolean>;
} | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<ConfirmRequest | null>(null);
  const toast = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  const confirm = useCallback(
    (opts: { title: string; message: ReactNode; confirmText?: string; danger?: boolean }) =>
      new Promise<boolean>((resolve) =>
        setPending({ title: opts.title, message: opts.message, confirmText: opts.confirmText ?? 'Confirm', danger: opts.danger ?? true, resolve }),
      ),
    [],
  );
  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            {t.text}
          </div>
        ))}
      </div>
      {pending && (
        <Modal
          title={pending.title}
          onClose={() => close(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => close(false)}>
                Cancel
              </button>
              <button type="button" className={`btn ${pending.danger ? 'danger' : 'primary'}`} onClick={() => close(true)}>
                {pending.confirmText}
              </button>
            </>
          }
        >
          <div className="text-2">{pending.message}</div>
        </Modal>
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback must be used inside FeedbackProvider');
  return ctx;
}

/** Wraps a mutation call with toast feedback for errors. */
export function useAction() {
  const { toast } = useFeedback();
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const result = await fn();
        if (success) toast(success);
        return result;
      } catch (err) {
        toast(errorMessage(err), 'error');
        return undefined;
      }
    },
    [toast],
  );
}

// ------------------------------------------------------------------ misc

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {total} item{total === 1 ? '' : 's'}
      </span>
      <div className="row">
        <button type="button" className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <span className="nowrap">
          Page {page} of {totalPages}
        </span>
        <button type="button" className="btn sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          className={`tab${t.id === value ? ' active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return withTime ? d.toLocaleString() : d.toLocaleDateString();
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function copyText(text: string): Promise<void> {
  return navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('Clipboard unavailable'));
}
