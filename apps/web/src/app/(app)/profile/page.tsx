"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError } from "../../../lib/api";
import { getMe, updateMe, type User } from "../../../lib/auth";

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((r) => {
        if (cancelled) return;
        setUser(r.user);
        setFirstName(r.user.firstName ?? "");
        setLastName(r.user.lastName ?? "");
        setPhone(r.user.phone ?? "");
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
          return;
        }
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Failed to load profile");
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="crm-page-title">Profile</h1>
        <p className="crm-page-desc">View and update your account details.</p>
      </div>

      <div className="crm-surface space-y-6 p-6 sm:p-7">
        <div className="text-sm text-zinc-600">
          Email{" "}
          <span className="font-medium text-zinc-900">{user?.email}</span>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div>
            <label className="crm-label" htmlFor="firstName">
              First name
            </label>
            <input
              id="firstName"
              className="crm-field"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div>
            <label className="crm-label" htmlFor="lastName">
              Last name
            </label>
            <input
              id="lastName"
              className="crm-field"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
          <div>
            <label className="crm-label" htmlFor="phone">
              Phone
            </label>
            <input
              id="phone"
              className="crm-field"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>

        {success ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {success}
          </div>
        ) : null}
        {error ? <div className="crm-alert-error">{error}</div> : null}

        <button
          type="button"
          className="crm-btn-primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            setSuccess(null);
            setError(null);
            try {
              const r = await updateMe({
                firstName: firstName || null,
                lastName: lastName || null,
                phone: phone || null,
              });
              setUser(r.user);
              setSuccess("Saved.");
            } catch (e) {
              setError(e instanceof ApiError ? e.message : "Failed to save");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
