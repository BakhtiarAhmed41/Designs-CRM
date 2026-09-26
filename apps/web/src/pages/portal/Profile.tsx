import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { updateProfile } from '@/lib/auth';
import { getMyCustomer, updateMyCustomer } from '@/lib/customers';
import { getErrorMessage } from '@/lib/api';
import { ErrorBanner, SuccessBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';

export function PortalProfile() {
  const { user, refresh } = useAuth();
  const { data: meCustomer, refetch: refetchCustomer } = useQuery({
    queryKey: ['portal-customer-me'],
    queryFn: getMyCustomer,
  });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accountType = meCustomer?.customer?.accountType ?? 'PAY_PER_ORDER';
  const accountLabel =
    accountType === 'NET_MONTHLY'
      ? meCustomer?.customer?.netTerms === 'NET_30'
        ? 'Net-monthly (Net-30)'
        : 'Net-monthly (Net-15)'
      : 'Pay per order';

  useEffect(() => {
    if (!user) return;
    setName(
      meCustomer?.customer?.name ||
        [user.firstName, user.lastName].filter(Boolean).join(' ') ||
        '',
    );
    setEmail(user.email ?? meCustomer?.customer?.email ?? '');
    setPhone(user.phone ?? meCustomer?.customer?.phone ?? '');
  }, [user, meCustomer]);

  async function onSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    setBusy(true);
    try {
      const parts = name.trim().split(/\s+/);
      await updateProfile({
        firstName: parts[0] || null,
        lastName: parts.slice(1).join(' ') || null,
        phone: phone || null,
      });
      await updateMyCustomer({
        name: name.trim() || undefined,
        phone: phone || null,
      });
      setMsg('Contact details saved.');
      await refresh();
      await refetchCustomer();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-elegant">
      <PageHeader title="Profile" subtitle="Your contact details." />

      <div className="card card-pad">
        <div className="profile-card-head">
          <h2 className="profile-card-title">Contact details</h2>
          <p className="profile-card-sub">Used on quotes, orders, and invoices.</p>
        </div>
        {msg && <SuccessBanner>{msg}</SuccessBanner>}
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <form onSubmit={(e) => void onSaveProfile(e)}>
          <div className="pform">
            <div className="pf">
              <label>Name or business</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="pf">
              <label>Email</label>
              <input type="email" value={email} disabled />
            </div>
            <div className="pf">
              <label>Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="pf">
              <label>Account type</label>
              <input value={accountLabel} disabled />
            </div>
          </div>
          <div className="note">
            <i className="ti ti-info-circle" />
            Email, account type, and payment terms are managed by our team. Message us if you need a
            change.
          </div>
          <div className="profile-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <i className="ti ti-check" /> {busy ? 'Saving…' : 'Save contact details'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
