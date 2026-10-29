import type { SessionInfo, User } from '@ibutest/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Laptop, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { type FormEvent, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { ErrorAlert, Loading, formatDate, useAction, useFeedback } from '../components/ui';

function ProfileCard() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const run = useAction();
  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await run(() => api<{ user: User }>('/auth/me', { method: 'PATCH', body: { name } }), 'Profile updated');
        if (res) setUser(res.user);
      }}
    >
      <h2>Profile</h2>
      <dl className="kv">
        <dt>Email</dt>
        <dd>{user?.email}</dd>
        <dt>Role</dt>
        <dd>{user?.role === 'admin' ? 'Administrator' : 'User'}</dd>
        <dt>Last sign-in</dt>
        <dd>{formatDate(user?.lastLoginAt, true)}</dd>
      </dl>
      <div className="field">
        <label htmlFor="pf-name">Display name</label>
        <input id="pf-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
      </div>
      <div className="form-actions">
        <button className="btn primary" type="submit">
          Save
        </button>
      </div>
    </form>
  );
}

function PasswordCard() {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const { toast } = useFeedback();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.next !== form.confirm) return setError('Passwords do not match');
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: form.current, newPassword: form.next } });
      setForm({ current: '', next: '', confirm: '' });
      setError(null);
      toast('Password changed. Other sessions were signed out.');
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form className="card stack" onSubmit={submit}>
      <h2 className="row">
        <KeyRound size={18} /> Password
      </h2>
      {error && <div className="alert error">{error}</div>}
      <div className="field">
        <label htmlFor="pw-cur">Current password</label>
        <input id="pw-cur" className="input" type="password" autoComplete="current-password" value={form.current} onChange={set('current')} required />
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="pw-new">New password</label>
          <input id="pw-new" className="input" type="password" autoComplete="new-password" value={form.next} onChange={set('next')} required />
        </div>
        <div className="field">
          <label htmlFor="pw-confirm">Confirm</label>
          <input id="pw-confirm" className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />
        </div>
      </div>
      <div className="form-actions">
        <button className="btn primary" type="submit">
          Change password
        </button>
      </div>
    </form>
  );
}

function MfaCard() {
  const { user, setUser } = useAuth();
  const { toast } = useFeedback();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refreshUser() {
    setUser((await api<{ user: User }>('/auth/me')).user);
  }
  async function start() {
    try {
      const res = await api<{ secret: string; otpauthUrl: string }>('/auth/mfa/setup', { method: 'POST' });
      const qr = await QRCode.toDataURL(res.otpauthUrl, { margin: 1, width: 400 });
      setSetup({ secret: res.secret, qr });
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function enable(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/auth/mfa/enable', { method: 'POST', body: { code } });
      setSetup(null);
      setCode('');
      await refreshUser();
      toast('Two-factor authentication enabled');
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function disable(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/auth/mfa/disable', { method: 'POST', body: { password, code } });
      setPassword('');
      setCode('');
      await refreshUser();
      toast('Two-factor authentication disabled');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="card stack">
      <h2 className="row">
        <ShieldCheck size={18} /> Two-factor authentication
      </h2>
      {error && <div className="alert error">{error}</div>}
      {user?.mfaEnabled ? (
        <form className="stack" onSubmit={disable}>
          <div className="alert info">Two-factor authentication is on. You will be asked for a code from your authenticator app at sign-in.</div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="mfa-pw">Password</label>
              <input id="mfa-pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="mfa-code-off">Current code</label>
              <input id="mfa-code-off" className="input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
            </div>
          </div>
          <div className="form-actions">
            <button className="btn danger" type="submit">
              Turn off two-factor
            </button>
          </div>
        </form>
      ) : setup ? (
        <form className="stack" onSubmit={enable}>
          <p className="text-2">Scan the QR code with an authenticator app (1Password, Google Authenticator, Microsoft Authenticator…), then enter the 6-digit code.</p>
          <div className="row wrap top">
            <img className="qr" src={setup.qr} alt="QR code for your authenticator app" />
            <div className="stack grow">
              <div className="field">
                <span className="field-label">Or enter this key manually</span>
                <code className="token">{setup.secret}</code>
              </div>
              <div className="field">
                <label htmlFor="mfa-code">Verification code</label>
                <input id="mfa-code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
              </div>
              <div className="row">
                <button className="btn primary" type="submit">
                  Verify and enable
                </button>
                <button className="btn" type="button" onClick={() => setSetup(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </form>
      ) : (
        <div className="row between wrap">
          <p className="text-2 grow">Protect your account with a time-based one-time code in addition to your password.</p>
          <button className="btn primary" type="button" onClick={start}>
            Set up two-factor
          </button>
        </div>
      )}
    </div>
  );
}

function SessionsCard() {
  const queryClient = useQueryClient();
  const run = useAction();
  const query = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ items: SessionInfo[] }>('/auth/sessions').then((r) => r.items) });
  const reload = () => queryClient.invalidateQueries({ queryKey: ['sessions'] });
  return (
    <div className="card flush">
      <div className="card-header">
        <h2 className="row">
          <Laptop size={18} /> Active sessions
        </h2>
        <button className="btn sm" type="button" onClick={() => run(() => api('/auth/sessions/revoke-others', { method: 'POST' }).then(reload), 'Other sessions signed out')}>
          Sign out other sessions
        </button>
      </div>
      <ErrorAlert error={query.error} />
      {query.isLoading ? (
        <Loading />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Device</th>
                <th>IP</th>
                <th>Signed in</th>
                <th>Last active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {query.data?.map((s) => (
                <tr key={s.id}>
                  <td className="title-cell truncate" title={s.userAgent ?? ''}>
                    {s.current && <span className="badge accent">This device</span>} {s.userAgent || 'Unknown'}
                  </td>
                  <td className="mono">{s.ip}</td>
                  <td className="nowrap">{formatDate(s.createdAt, true)}</td>
                  <td className="nowrap">{formatDate(s.lastUsedAt, true)}</td>
                  <td>
                    {!s.current && (
                      <button className="btn sm danger" type="button" onClick={() => run(() => api(`/auth/sessions/${s.id}`, { method: 'DELETE' }).then(reload), 'Session revoked')}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ProfilePage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Profile &amp; security</h1>
          <p className="subtitle">Manage your account, password, two-factor authentication and sessions.</p>
        </div>
      </div>
      <div className="stack loose">
        <div className="grid-2">
          <ProfileCard />
          <PasswordCard />
        </div>
        <MfaCard />
        <SessionsCard />
      </div>
    </>
  );
}
