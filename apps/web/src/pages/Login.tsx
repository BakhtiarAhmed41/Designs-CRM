import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { forgotPassword, resetPassword } from '@/lib/auth';
import { getErrorMessage } from '@/lib/api';

type Mode = 'login' | 'register' | 'forgot' | 'reset';

export function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'register') {
        const res = await register({
          email,
          password,
          name,
          phone: phone || null,
        });
        if (res.pending) {
          setInfo(
            'Your account verification is in progress. Please wait for admin approval before signing in.',
          );
          setMode('login');
          return;
        }
      } else if (mode === 'forgot') {
        const res = await forgotPassword(email);
        if (res.resetToken) {
          setResetToken(res.resetToken);
          setMode('reset');
          setInfo(
            'No email provider is configured. Use the reset token below to set a new password (local/dev).',
          );
        } else {
          setInfo(
            'If that account exists, a reset token was created. Ask an admin to complete the reset — email delivery is not configured.',
          );
        }
        return;
      } else if (mode === 'reset') {
        await resetPassword(resetToken, password);
        setInfo('Password updated. You can sign in now.');
        setMode('login');
        return;
      } else {
        await login(email, password);
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="login-card">
        <div className="login-brand">
          <img src="/lvd-logo.png" alt="LVD" />
          <div>
            <div className="login-title">Las Vegas Designs</div>
            <div className="login-sub">
              {mode === 'login' && 'Sign in to your account'}
              {mode === 'register' && 'Create your account'}
              {mode === 'forgot' && 'Reset your password'}
              {mode === 'reset' && 'Choose a new password'}
            </div>
          </div>
        </div>

        {error && <div className="alert-error" style={{ marginBottom: 14 }}>{error}</div>}
        {info && (
          <div
            className="alert-error"
            style={{
              marginBottom: 14,
              background: 'rgba(20,63,101,.06)',
              color: 'var(--navy)',
              border: '0.5px solid var(--line)',
            }}
          >
            {info}
          </div>
        )}

        <form className="login-form" onSubmit={onSubmit}>
          {mode === 'register' && (
            <>
              <label className="login-field">
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <label className="login-field">
                <span>Phone number</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} required />
              </label>
            </>
          )}
          {(mode === 'login' || mode === 'register' || mode === 'forgot') && (
            <label className="login-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </label>
          )}
          {mode === 'reset' && (
            <label className="login-field">
              <span>Reset token</span>
              <input value={resetToken} onChange={(e) => setResetToken(e.target.value)} required />
            </label>
          )}
          {(mode === 'login' || mode === 'register' || mode === 'reset') && (
            <label className="login-field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === 'login' ? 1 : 6}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </label>
          )}
          <button className="btn btn-primary login-submit" disabled={busy} type="submit">
            {busy
              ? 'Please wait…'
              : mode === 'login'
                ? 'Sign in'
                : mode === 'register'
                  ? 'Create account'
                  : mode === 'forgot'
                    ? 'Send reset'
                    : 'Update password'}
          </button>
        </form>

        <div className="login-switch">
          {mode === 'login' && (
            <>
              <button
                type="button"
                className="login-switch-btn"
                onClick={() => {
                  setMode('forgot');
                  setError(null);
                  setInfo(null);
                }}
              >
                Forgot password?
              </button>
              <span style={{ margin: '0 8px', color: 'var(--faint)' }}>·</span>
              Don&apos;t have an account?{' '}
              <button
                type="button"
                className="login-switch-btn"
                onClick={() => {
                  setMode('register');
                  setError(null);
                  setInfo(null);
                }}
              >
                Create new account
              </button>
            </>
          )}
          {mode !== 'login' && (
            <button
              type="button"
              className="login-switch-btn"
              onClick={() => {
                setMode('login');
                setError(null);
                setInfo(null);
              }}
            >
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
