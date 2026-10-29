import { PASSWORD_MIN_LENGTH, type SessionResponse, type User } from '@ibutest/shared';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { Loading } from '../components/ui';
import { getServerUrl, isNative, normaliseServerUrl, setServerUrl } from '../lib/platform';

function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="auth-screen">
      <div className="auth-card stack loose">
        <div className="stack tight">
          <div className="brand">
            <img src="/icon.svg" alt="" /> IbuTest
          </div>
          <h1 style={{ textAlign: 'center', fontSize: 18 }}>{title}</h1>
          {subtitle && (
            <p className="muted small" style={{ textAlign: 'center' }}>
              {subtitle}
            </p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function ServerLine() {
  const server = getServerUrl();
  if (!server) return null;
  return (
    <p className="small muted" style={{ textAlign: 'center' }}>
      Server: <span className="mono">{server}</span> ·{' '}
      <a
        href="/connect"
        onClick={(e) => {
          e.preventDefault();
          setServerUrl(null);
          window.location.assign('/connect');
        }}
      >
        Change
      </a>
    </p>
  );
}

export function LoginPage() {
  const { ready, status, user, login, verifyMfa, completeSession } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isNative() && !getServerUrl()) return <Navigate to="/connect" replace />;
  if (!ready) return <Loading />;
  if (status?.setupRequired) return <Navigate to="/setup" replace />;
  const from = (location.state as { from?: string } | null)?.from;
  if (user) return <Navigate to={from && from.startsWith('/') && !from.startsWith('//') ? from : '/'} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mfaToken) {
        await verifyMfa(mfaToken, code);
      } else if (registering) {
        completeSession(await api<SessionResponse>('/auth/register', { method: 'POST', body: { name, email, password } }));
      } else {
        const result = await login(email, password);
        if (result) setMfaToken(result.mfaToken);
      }
      setPassword('');
    } catch (err) {
      setError(errorMessage(err));
      if (mfaToken) setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={mfaToken ? 'Two-factor verification' : registering ? 'Create your account' : 'Sign in'}
      subtitle={mfaToken ? 'Enter the 6-digit code from your authenticator app.' : undefined}
    >
      <form className="stack" onSubmit={submit} noValidate>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {mfaToken ? (
          <div className="field">
            <label htmlFor="code">Verification code</label>
            <input
              id="code"
              className="input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
              required
            />
          </div>
        ) : (
          <>
            {registering && (
              <div className="field">
                <label htmlFor="name">Full name</label>
                <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
              </div>
            )}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
                autoFocus
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete={registering ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={128}
                required
              />
              {registering && <span className="hint">At least {PASSWORD_MIN_LENGTH} characters.</span>}
            </div>
          </>
        )}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mfaToken ? 'Verify' : registering ? 'Create account' : 'Sign in'}
        </button>
        {mfaToken && (
          <button type="button" className="btn ghost" onClick={() => setMfaToken(null)}>
            Back
          </button>
        )}
        {!mfaToken && status?.registrationEnabled && (
          <button type="button" className="btn ghost" onClick={() => setRegistering((r) => !r)}>
            {registering ? 'I already have an account' : 'Create an account'}
          </button>
        )}
      </form>
      <ServerLine />
    </AuthCard>
  );
}

export function SetupPage() {
  const { ready, status, completeSession } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', setupToken: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The desktop app passes a one-time setup token in the URL fragment (never sent to servers).
    const m = /(?:^|[#&])setupToken=([\w-]+)/.exec(window.location.hash);
    if (m?.[1]) {
      setForm((f) => ({ ...f, setupToken: m[1]! }));
      history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  if (!ready) return <Loading />;
  if (!status?.setupRequired) return <Navigate to="/login" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirm) return setError('Passwords do not match');
    setBusy(true);
    setError(null);
    try {
      const session = await api<SessionResponse>('/auth/setup', {
        method: 'POST',
        body: { name: form.name, email: form.email, password: form.password, ...(form.setupToken ? { setupToken: form.setupToken } : {}) },
      });
      completeSession(session);
      window.location.replace('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <AuthCard title="Welcome to IbuTest" subtitle="Create the first administrator account to get started.">
      <form className="stack" onSubmit={submit}>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <div className="field">
          <label htmlFor="s-name">Full name</label>
          <input id="s-name" className="input" value={form.name} onChange={set('name')} maxLength={100} required />
        </div>
        <div className="field">
          <label htmlFor="s-email">Email</label>
          <input id="s-email" className="input" type="email" autoComplete="username" value={form.email} onChange={set('email')} required />
        </div>
        <div className="field">
          <label htmlFor="s-pass">Password</label>
          <input id="s-pass" className="input" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required />
          <span className="hint">At least {PASSWORD_MIN_LENGTH} characters. A passphrase is ideal.</span>
        </div>
        <div className="field">
          <label htmlFor="s-confirm">Confirm password</label>
          <input id="s-confirm" className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />
        </div>
        {status.setupTokenRequired && (
          <div className="field">
            <label htmlFor="s-token">Setup token</label>
            <input id="s-token" className="input mono" value={form.setupToken} onChange={set('setupToken')} autoComplete="off" required />
            <span className="hint">The SETUP_TOKEN value from the server configuration.</span>
          </div>
        )}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create administrator'}
        </button>
      </form>
    </AuthCard>
  );
}

export function ChangePasswordPage({ forced }: { forced?: boolean }) {
  const { setUser, logout } = useAuth();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.next !== form.confirm) return setError('Passwords do not match');
    setBusy(true);
    setError(null);
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: form.current, newPassword: form.next } });
      const me = await api<{ user: User }>('/auth/me');
      setUser(me.user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <AuthCard title="Choose a new password" subtitle={forced ? 'Your administrator requires you to set a new password.' : undefined}>
      <form className="stack" onSubmit={submit}>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <div className="field">
          <label htmlFor="c-cur">Current (temporary) password</label>
          <input id="c-cur" className="input" type="password" autoComplete="current-password" value={form.current} onChange={set('current')} required />
        </div>
        <div className="field">
          <label htmlFor="c-new">New password</label>
          <input id="c-new" className="input" type="password" autoComplete="new-password" value={form.next} onChange={set('next')} required />
          <span className="hint">At least {PASSWORD_MIN_LENGTH} characters.</span>
        </div>
        <div className="field">
          <label htmlFor="c-confirm">Confirm new password</label>
          <input id="c-confirm" className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />
        </div>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Update password'}
        </button>
        <button type="button" className="btn ghost" onClick={() => void logout()}>
          Sign out
        </button>
      </form>
    </AuthCard>
  );
}

/** Mobile apps: choose the IbuTest server to connect to. Also shown when the server is unreachable. */
export function ConnectServerPage({ unreachable }: { unreachable?: boolean }) {
  const { reloadStatus } = useAuth();
  const [url, setUrl] = useState(getServerUrl() ?? 'https://');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isNative() && !unreachable) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const origin = normaliseServerUrl(url);
    if (!origin) return setError('Enter a valid https:// address');
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${origin}/api/auth/status`, { credentials: 'include' });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { setupRequired?: unknown };
      if (typeof body.setupRequired !== 'boolean') throw new Error();
      setServerUrl(origin);
      window.location.replace('/');
    } catch {
      setError('Could not reach an IbuTest server at that address.');
    } finally {
      setBusy(false);
    }
  }

  if (unreachable && !isNative()) {
    return (
      <AuthCard title="Server unavailable" subtitle="IbuTest cannot reach its server right now.">
        <button className="btn primary" type="button" onClick={() => void reloadStatus()}>
          Try again
        </button>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Connect to your server" subtitle="Enter the address of your team's IbuTest server.">
      <form className="stack" onSubmit={submit}>
        {(error || unreachable) && (
          <div className="alert error" role="alert">
            {error ?? 'The saved server could not be reached.'}
          </div>
        )}
        <div className="field">
          <label htmlFor="server">Server address</label>
          <input
            id="server"
            className="input mono"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <span className="hint">Only secure (https) connections are allowed.</span>
        </div>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </form>
    </AuthCard>
  );
}
