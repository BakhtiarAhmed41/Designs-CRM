import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { confirmEmailChange, forgotPassword, resetPassword, verifyEmail } from '@/lib/auth';
import { claimQuoteIntent } from '@/lib/orders';
import { getErrorMessage } from '@/lib/api';
import { orderSlug } from '@/lib/format';
import { PHONE_COUNTRIES } from '@/lib/phoneCountries';
import { PhoneCountrySelect } from '@/components/PhoneCountrySelect';

type Mode = 'login' | 'register' | 'forgot' | 'reset';



export function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneCountry, setPhoneCountry] = useState('US');
  const [passwordTouched, setPasswordTouched] = useState(false);
  const shortSignupPassword = mode === 'register' && passwordTouched && password.length < 8;
  const [resetToken, setResetToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const reset = searchParams.get('reset');
    const verify = searchParams.get('verify');
    if (reset) {
      setResetToken(reset);
      setMode('reset');
      setInfo('Enter a new password to finish resetting your account.');
    }
    if (verify) {
      setBusy(true);
      void verifyEmail(verify)
        .then(() => {
          setInfo(
            'Email verified. Your login request is pending admin approval. You can sign in after approval.',
          );
          setMode('login');
        })
        .catch((err) => setError(getErrorMessage(err)))
        .finally(() => setBusy(false));
    }
    const emailChange = searchParams.get('emailChange');
    if (emailChange) {
      setBusy(true);
      void confirmEmailChange(emailChange)
        .then(() => {
          setInfo('Email updated. Sign in with your new address.');
          setMode('login');
        })
        .catch((err) => setError(getErrorMessage(err)))
        .finally(() => setBusy(false));
    }
  }, [searchParams]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'register' && password.length < 8) {
      setPasswordTouched(true);
      return;
    }
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'register') {
        const res = await register({
          email,
          password,
          name,
          phone: phone.trim()
            ? `+${PHONE_COUNTRIES.find(([country]) => country === phoneCountry)![1]} ${phone.trim()}`
            : null,
        });
        if (res.pending) {
          setInfo(
            res.emailSent
              ? 'Account created. Check your email to verify your address. An admin will then approve your login.'
              : 'Account created. An admin will approve your login. You can sign in after approval.',
          );
          setMode('login');
          return;
        }
      } else if (mode === 'forgot') {
        const res = await forgotPassword(email);
        if (res.emailSent) {
          setInfo('If that account exists, a password reset link was sent to your email.');
        } else if (res.resetToken) {
          setResetToken(res.resetToken);
          setMode('reset');
          setInfo(
            'SMTP is not configured. Use the reset token below (dev only) to set a new password.',
          );
        } else {
          setInfo(
            'If that account exists, a reset was prepared. Configure SMTP_HOST on the API to deliver emails.',
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
        const claim = searchParams.get('claim');
        if (claim) {
          try {
            const claimed = await claimQuoteIntent(claim);
            navigate(`/portal/quotes/${orderSlug(claimed.order.humanRef, claimed.order.id)}`, { replace: true });
            return;
          } catch (err) {
            navigate('/portal/quotes', {
              replace: true,
              state: {
                claimError:
                  getErrorMessage(err) ||
                  'Signed in, but we could not attach your quote request. Open Quotes to continue.',
              },
            });
            return;
          }
        }
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function changeMode(next: Mode) {
    setMode(next);
    setError(null);
    setInfo(null);
    setShowPassword(false);
    setPasswordTouched(false);
  }

  return (
    <div className="center-screen customer-auth">
      <div className={'login-card login-card--' + mode}>
        <aside className="login-story" aria-label="Customer portal benefits">
          <p className="login-kicker">Customer portal</p>
          <div className="login-story-content">
            <h2>Your designs,<br />all in one place.</h2>
            <ul className="login-benefits">
              <li><span className="login-benefit-icon"><i className="ti ti-file-invoice" aria-hidden="true" /></span>Track quotes and orders</li>
              <li><span className="login-benefit-icon"><i className="ti ti-download" aria-hidden="true" /></span>Download your files anytime</li>
              <li><span className="login-benefit-icon"><i className="ti ti-message-circle" aria-hidden="true" /></span>Chat with our design team</li>
            </ul>
          </div>
          <svg className="login-stitching" viewBox="0 0 400 280" fill="none" preserveAspectRatio="none" aria-hidden="true">
            <path d="M-40 20C55 290 175 320 440 70M-30 130C120 140 180 310 430 250M-20 260C120 350 220 70 440 30" />
            <path d="M-20 80C80 340 195 270 420 170" />
          </svg>
          <p className="login-story-footer">Every project. Every detail. Connected.</p>
        </aside>
        <section className="login-panel" aria-labelledby="login-heading">
          <div className="login-brand">
            <img src="/lvd-logo-full.png" alt="Las Vegas Designs USA" />
          </div>
          <div className="login-heading">
            <h1 id="login-heading">
              {mode === 'login' && 'Welcome back'}
              {mode === 'register' && 'Create your account'}
              {mode === 'forgot' && 'Reset your password'}
              {mode === 'reset' && 'Choose a new password'}
            </h1>
            <p className="login-sub">
              {mode === 'login' && 'Sign in to see your quotes, orders and files.'}
              {mode === 'register' && 'It takes less than a minute.'}
              {mode === 'forgot' && 'Enter your email to receive a reset link.'}
              {mode === 'reset' && 'Set a new password to get back to your designs.'}
            </p>
          </div>

          {error && <div className="alert-error" role="alert">{error}</div>}
          {info && <div className="login-info" role="status">{info}</div>}

          <form className="login-form" onSubmit={onSubmit}>
            {mode === 'register' && (
              <label className="login-field">
                <span>Full name <em aria-hidden="true">*</em></span>
                <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" placeholder="John Smith" />
              </label>
            )}
            {(mode === 'login' || mode === 'register' || mode === 'forgot') && (
              <label className="login-field">
                <span>Email {mode === 'register' && <em aria-hidden="true">*</em>}</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="you@email.com" />
              </label>
            )}
            {mode === 'register' && (
              <div className="login-field">
                <label htmlFor="login-phone">Phone number <span className="login-optional">(optional)</span></label>
                <div className="login-phone-wrap">
                  <PhoneCountrySelect value={phoneCountry} onChange={setPhoneCountry} />
                  <input id="login-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel-national" placeholder="555 123 4567" pattern={'[0-9\\(\\) .\\-]+'} title="Enter your phone number without the country code; select it from the dropdown." />
                </div>
              </div>
            )}
            {mode === 'reset' && (
              <label className="login-field">
                <span>Reset token</span>
                <input value={resetToken} onChange={(e) => setResetToken(e.target.value)} required />
              </label>
            )}
            {(mode === 'login' || mode === 'register' || mode === 'reset') && (
              <div className="login-field">
                <div className="login-field-heading">
                  <label htmlFor="login-password">Password {mode === 'register' && <em aria-hidden="true">*</em>}</label>
                  {mode === 'login' && <button type="button" className="login-switch-btn" disabled={busy} onClick={() => changeMode('forgot')}>Forgot password?</button>}
                </div>
                <div className="login-password-wrap">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => setPasswordTouched(true)}
                    onInvalid={() => setPasswordTouched(true)}
                    required
                    minLength={mode === 'login' ? 1 : mode === 'register' ? 8 : 6}
                    aria-invalid={shortSignupPassword || undefined}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    aria-describedby={mode !== 'login' ? 'login-password-hint' : undefined}
                  />
                  <button type="button" className="login-password-toggle" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
                    <i className={'ti ' + (showPassword ? 'ti-eye-off' : 'ti-eye')} aria-hidden="true" />
                  </button>
                </div>
                {mode !== 'login' && (
                  <small id="login-password-hint" className={shortSignupPassword ? 'login-hint login-field-error' : 'login-hint'} role={shortSignupPassword ? 'alert' : undefined}>
                    {shortSignupPassword ? 'Password must be at least 8 characters.' : mode === 'register' ? 'At least 8 characters.' : 'At least 6 characters.'}
                  </small>
                )}
              </div>
            )}
            <button className="btn btn-primary login-submit" disabled={busy} type="submit">
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Send reset' : 'Update password'}
            </button>
          </form>

          <div className="login-switch">
            {mode === 'login' ? (
              <>Don&apos;t have an account?{' '}<button type="button" className="login-switch-btn" disabled={busy} onClick={() => changeMode('register')}>Create account</button></>
            ) : mode === 'register' ? (
              <>Already have an account?{' '}<button type="button" className="login-switch-btn" disabled={busy} onClick={() => changeMode('login')}>Sign in</button></>
            ) : (
              <button type="button" className="login-switch-btn" disabled={busy} onClick={() => changeMode('login')}>Back to sign in</button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
