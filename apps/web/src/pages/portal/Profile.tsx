import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { forgotPassword, updateProfile } from '@/lib/auth';
import { getMyCustomer, updateMyCustomer } from '@/lib/customers';
import { getErrorMessage } from '@/lib/api';
import { ErrorBanner, SuccessBanner } from '@/components/ui/EmptyState';
import '@/styles/portal-account.css';

type Details = Record<
  | 'organization'
  | 'country'
  | 'username'
  | 'street'
  | 'city'
  | 'state'
  | 'postalCode',
  string
>;
const EMPTY: Details = {
  organization: '',
  country: '',
  username: '',
  street: '',
  city: '',
  state: '',
  postalCode: '',
};
function readDetails(prefs: unknown): Details {
  const raw =
    prefs && typeof prefs === 'object'
      ? (prefs as { profileDetails?: unknown }).profileDetails
      : null;
  return Object.fromEntries(
    Object.keys(EMPTY).map((key) => [
      key,
      raw &&
      typeof raw === 'object' &&
      typeof (raw as Record<string, unknown>)[key] === 'string'
        ? (raw as Record<string, string>)[key]
        : '',
    ]),
  ) as Details;
}
export function PortalProfile() {
  const { user, refresh } = useAuth();
  const { data, refetch, isLoading, isError } = useQuery({
    queryKey: ['portal-customer-me'],
    queryFn: getMyCustomer,
  });
  const customer = data?.customer;
  const savedName =
    customer?.name ||
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    '';
  const savedPhone = user?.phone ?? customer?.phone ?? '';
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [details, setDetails] = useState<Details>(EMPTY);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  useEffect(() => {
    setName(savedName);
    setPhone(savedPhone);
    setDetails(readDetails(customer?.preferences));
  }, [savedName, savedPhone, customer?.preferences]);
  const changed =
    name !== savedName ||
    phone !== savedPhone ||
    JSON.stringify(details) !==
      JSON.stringify(readDetails(customer?.preferences));
  const initials =
    savedName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'U';
  const since = new Date(customer?.sinceDate || customer?.createdAt || '');
  const sinceLabel = Number.isNaN(since.getTime())
    ? '—'
    : since.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const accountLabel =
    customer?.accountType === 'NET_MONTHLY'
      ? 'Net-monthly (' +
        (customer.netTerms === 'NET_30' ? 'Net-30' : 'Net-15') +
        ')'
      : 'Pay per order';
  function cancel() {
    setName(savedName);
    setPhone(savedPhone);
    setDetails(readDetails(customer?.preferences));
    setMessage(null);
    setError(null);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const parts = name.trim().split(/\s+/);
      await updateProfile({
        firstName: parts[0] || null,
        lastName: parts.slice(1).join(' ') || null,
        phone: phone.trim() || null,
      });
      const latest = (await getMyCustomer()).customer?.preferences;
      await updateMyCustomer({
        name: name.trim(),
        phone: phone.trim() || null,
        preferences: {
          ...(latest && typeof latest === 'object' ? latest : {}),
          profileDetails: Object.fromEntries(
            Object.entries(details).map(([key, value]) => [key, value.trim()]),
          ),
        },
      });
      await refresh();
      await refetch();
      setMessage('Profile changes saved.');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function changePassword() {
    if (!user?.email) return;
    setPasswordBusy(true);
    setPasswordMessage(null);
    setPasswordError(null);
    try {
      const result = await forgotPassword(user.email);
      if (!result.emailSent)
        throw new Error(
          'The password reset email could not be sent. Please contact our team.',
        );
      setPasswordMessage(
        'A password reset link has been sent to your email address.',
      );
    } catch (err) {
      setPasswordError(getErrorMessage(err));
    } finally {
      setPasswordBusy(false);
    }
  }
  function field(
    key: keyof Details,
    label: string,
    placeholder: string,
    autoComplete?: string,
  ) {
    return (
      <div className={'pf' + (key === 'street' ? ' account-full' : '')}>
        <label htmlFor={'profile-' + key}>
          {label} <span className="muted">(optional)</span>
        </label>
        <input
          id={'profile-' + key}
          autoComplete={autoComplete}
          maxLength={key === 'street' ? 300 : 200}
          placeholder={placeholder}
          value={details[key]}
          onChange={(event) =>
            setDetails((prev) => ({ ...prev, [key]: event.target.value }))
          }
        />
      </div>
    );
  }
  return (
    <div className="profile-elegant portal-account">
      <nav className="crumbs" aria-label="Breadcrumb">
        <span>Account</span>
        <span aria-hidden>/</span>
        <span>Profile</span>
      </nav>
      <header className="account-identity">
        <div className="account-avatar" aria-hidden>
          {initials}
        </div>
        <div>
          <h1>{savedName || 'Your profile'}</h1>
          <p className="profile-card-sub">{user?.email || customer?.email}</p>
        </div>
      </header>
      {message && <SuccessBanner>{message}</SuccessBanner>}
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {isError && (
        <ErrorBanner>
          We could not load your profile. Refresh and try again.
        </ErrorBanner>
      )}
      <form className="card card-pad" onSubmit={(event) => void save(event)}>
        <div className="profile-card-head">
          <h2 className="profile-card-title">Contact details</h2>
        </div>
        <fieldset
          className="account-fields"
          disabled={busy || isLoading || isError}
        >
          <div className="pform">
            <div className="pf">
              <label htmlFor="profile-name">Name</label>
              <input
                id="profile-name"
                autoComplete="name"
                required
                maxLength={160}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            {field(
              'organization',
              'Organization name',
              'Enter organization name',
              'organization',
            )}
            <div className="pf">
              <label htmlFor="profile-email">Email address</label>
              <input
                id="profile-email"
                type="email"
                value={user?.email || customer?.email || ''}
                disabled
              />
            </div>
            <div className="pf">
              <label htmlFor="profile-phone">Phone number</label>
              <input
                id="profile-phone"
                type="tel"
                autoComplete="tel"
                maxLength={30}
                placeholder="Phone number, including country code"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
            {field('country', 'Country', 'Enter country', 'country-name')}
            {field('username', 'Username', 'Enter username')}
          </div>
          <div className="account-section-heading">
            <h2 className="profile-card-title">Billing address</h2>
          </div>
          <div className="pform">
            {field(
              'street',
              'Street address',
              'Street address',
              'street-address',
            )}
            {field('city', 'City', 'Enter city', 'address-level2')}
            {field(
              'state',
              'State/Province',
              'Enter state or province',
              'address-level1',
            )}
            {field(
              'postalCode',
              'ZIP/Postal code',
              'ZIP / Postal code',
              'postal-code',
            )}
          </div>
          <div className="profile-actions account-actions">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!changed}
              onClick={cancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!changed || !name.trim()}
            >
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </fieldset>
      </form>
      <section className="card card-pad">
        <div className="account-security">
          <div>
            <h2 className="profile-card-title">Password &amp; security</h2>
            <p className="profile-card-sub">
              Password <span aria-label="Password hidden">••••••••••</span>
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={passwordBusy || !user?.email}
            onClick={() => void changePassword()}
          >
            {passwordBusy ? 'Sending…' : 'Change password'}
          </button>
        </div>
        {passwordMessage && <SuccessBanner>{passwordMessage}</SuccessBanner>}
        {passwordError && <ErrorBanner>{passwordError}</ErrorBanner>}
      </section>
      <section className="card card-pad">
        <div className="account-info-heading">
          <h2 className="profile-card-title">Account information</h2>
          <span className="profile-hint">
            <i className="ti ti-lock" aria-hidden /> Managed by our team
          </span>
        </div>
        <dl className="account-info">
          <div>
            <dt>Account type</dt>
            <dd>{accountLabel}</dd>
          </div>
          <div>
            <dt>Customer since</dt>
            <dd>{sinceLabel}</dd>
          </div>
        </dl>
        <p className="profile-hint">
          Message our team to update your email address or payment terms.
        </p>
      </section>
    </div>
  );
}
