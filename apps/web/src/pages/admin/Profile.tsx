import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { requestEmailChange, updateProfile } from '@/lib/auth';
import { getErrorMessage } from '@/lib/api';
import { ErrorBanner, SuccessBanner } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';

export function AdminProfile() {
  const { user, refresh } = useAuth();
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <div>
      <PageHeader title="My profile" subtitle="Your name, phone, and email for this staff account." />
      <div className="card card-pad">
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
              <input value={email} onChange={(e) => setEmail(e.target.value)} />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 8 }}
                onClick={() => {
                  void requestEmailChange(email)
                    .then((res) =>
                      setMsg(
                        res.emailSent
                          ? `Check ${res.pendingEmail} for a confirmation link.`
                          : `Pending change saved for ${res.pendingEmail}. SMTP is not configured yet.`,
                      ),
                    )
                    .catch((err) => setError(getErrorMessage(err)));
                }}
              >
                Send confirmation to new email
              </button>
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </div>
    </div>
  );
}
