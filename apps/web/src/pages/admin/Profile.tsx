import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { requestEmailChange, updateProfile } from '@/lib/auth';
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
  const [email, setEmail] = useState(user?.email ?? '');
  const [originalEmail, setOriginalEmail] = useState(user?.email ?? '');
  const [emailBusy, setEmailBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName ?? '');
    setLastName(user.lastName ?? '');
    setPhone(user.phone ?? '');
    setEmail(user.email ?? '');
    setOriginalEmail(user.email ?? '');
  }, [user]);

  const emailChanged =
    email.trim().length > 0 &&
    email.trim().toLowerCase() !== originalEmail.trim().toLowerCase();

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

  async function onConfirmEmail() {
    setMsg(null);
    setError(null);
    setEmailBusy(true);
    try {
      const res = await requestEmailChange(email.trim());
      setMsg(
        res.emailSent
          ? `Check ${res.pendingEmail} for a confirmation link.`
          : `Pending change saved for ${res.pendingEmail}. SMTP is not configured yet.`,
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setEmailBusy(false);
    }
  }

  return (
    <div className="profile-elegant">
      <PageHeader
        title="My profile"
        subtitle="Your name, phone, and email for this staff account."
      />

      <div className="card card-pad">
        <h2 className="profile-card-title">Account details</h2>
        <p className="profile-card-sub">
          These details appear on messages and activity from your account.
        </p>
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
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button
                type="button"
                className="profile-email-btn"
                disabled={!emailChanged || emailBusy}
                onClick={() => void onConfirmEmail()}
              >
                <i className="ti ti-mail" aria-hidden />
                {emailBusy ? 'Sending…' : 'Send confirmation to new email'}
              </button>
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
            Change the email, then send a confirmation link to the new address. Your role is set by
            an admin.
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
