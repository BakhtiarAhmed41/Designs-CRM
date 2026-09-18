import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { updateProfile } from '@/lib/auth';
import { getErrorMessage } from '@/lib/api';
import { ErrorBanner, SuccessBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';

function roleLabel(role?: string | null) {
  if (role === 'SUPER_ADMIN') return 'Super admin';
  if (role === 'ADMIN') return 'Admin';
  if (role === 'SUPPORT') return 'Support';
  if (role === 'DESIGNER') return 'Designer';
  return role || 'Staff';
}

export function AdminProfile() {
  const { user, refresh } = useAuth();
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName ?? '');
    setLastName(user.lastName ?? '');
    setPhone(user.phone ?? '');
  }, [user]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    setBusy(true);
    try {
      await updateProfile({
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        phone: phone.trim() || null,
      });
      await refresh();
      setMsg('Profile saved.');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-elegant">
      <PageHeader
        title="My profile"
        subtitle="Your name and phone for this staff account."
      />

      <div className="card card-pad">
        <div className="profile-card-head">
          <h2 className="profile-card-title">Account details</h2>
          <p className="profile-card-sub">
            These details appear on messages and activity from your account.
          </p>
        </div>
        {msg && <SuccessBanner>{msg}</SuccessBanner>}
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <form onSubmit={(e) => void onSave(e)}>
          <div className="pform">
            <div className="pf">
              <label>First name</label>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="pf">
              <label>Last name</label>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div className="pf">
              <label>Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="pf">
              <label>Email</label>
              <div className="profile-lock-field">
                <i className="ti ti-lock" aria-hidden />
                <input type="email" value={user?.email ?? ''} disabled />
              </div>
            </div>
            <div className="pf">
              <label>Role</label>
              <div className="profile-lock-field">
                <i className="ti ti-lock" aria-hidden />
                <input value={roleLabel(user?.role)} disabled />
              </div>
            </div>
          </div>
          <div className="note">
            <i className="ti ti-info-circle" />
            Email and role are set by an admin. Message the team if you need those changed.
          </div>
          <div className="profile-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <i className="ti ti-check" /> {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
