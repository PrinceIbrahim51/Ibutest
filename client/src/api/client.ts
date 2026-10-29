import { CSRF_HEADER, CSRF_HEADER_VALUE, type ApiErrorBody, type SessionResponse } from '@ibutest/shared';
import { getServerUrl, isNative } from '../lib/platform';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

/**
 * The access token lives only in memory (never in localStorage) so injected scripts or
 * other origins cannot read it from storage. The refresh token is an httpOnly cookie.
 */
let accessToken: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let refreshInFlight: Promise<SessionResponse | null> | null = null;
const listeners = new Set<(session: SessionResponse | null) => void>();

export function onSessionChange(fn: (session: SessionResponse | null) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function apiBase(): string {
  const server = getServerUrl();
  return server ? `${server}/api` : '/api';
}

export function setSession(session: SessionResponse | null) {
  accessToken = session?.accessToken ?? null;
  clearTimeout(refreshTimer);
  if (session) {
    // Refresh proactively at 80% of the access token lifetime.
    refreshTimer = setTimeout(() => void refreshSession(), Math.max(30, session.expiresIn * 0.8) * 1000);
  }
  for (const fn of listeners) fn(session);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exchanges the refresh cookie for a new access token (single-flight across callers). */
export function refreshSession(): Promise<SessionResponse | null> {
  refreshInFlight ??= (async () => {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(`${apiBase()}/auth/refresh`, {
          method: 'POST',
          credentials: isNative() ? 'include' : 'same-origin',
          headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE },
        });
        if (res.ok) {
          const session = (await res.json()) as SessionResponse;
          setSession(session);
          return session;
        }
        // Another tab refreshed at the same moment; the browser now holds the new cookie.
        if (res.status === 409) {
          await sleep(300 * (attempt + 1));
          continue;
        }
        break;
      }
      setSession(null);
      return null;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Query;
  /** Return the raw Response (downloads). */
  raw?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Query): string {
  const url = `${apiBase()}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const isForm = options.body instanceof FormData;
  const send = () =>
    fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      credentials: isNative() ? 'include' : 'same-origin',
      signal: options.signal,
      headers: {
        ...(options.body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        [CSRF_HEADER]: CSRF_HEADER_VALUE,
      },
      body: options.body === undefined ? undefined : isForm ? (options.body as FormData) : JSON.stringify(options.body),
    });

  let res = await send();
  if (res.status === 401 && accessToken && !path.startsWith('/auth/refresh')) {
    if (await refreshSession()) res = await send();
  }
  if (!res.ok) {
    let body: Partial<ApiErrorBody> = {};
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      /* non-JSON error */
    }
    if (res.status === 401 && !path.startsWith('/auth/')) setSession(null);
    throw new ApiError(res.status, body.error?.code ?? 'HTTP_ERROR', body.error?.message ?? `Request failed (${res.status})`, body.error?.details);
  }
  if (options.raw) return res as T;
  // null (not undefined) so callers can tell "succeeded with no body" from a failed action.
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

/** Downloads an authenticated file (CSV exports, attachments) without exposing the token in a URL. */
export async function downloadFile(path: string, fallbackName: string) {
  const res = await api<Response>(path, { raw: true });
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/.exec(disposition);
  const name = match ? decodeURIComponent(match[1] ?? match[2] ?? fallbackName) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.details?.length) return `${err.message}: ${err.details.map((d) => (d.path ? `${d.path} - ${d.message}` : d.message)).join('; ')}`;
    return err.message;
  }
  if (err instanceof TypeError) return 'Cannot reach the server. Check your connection.';
  return 'Something went wrong';
}
