"use client";

import { useEffect, useState } from "react";
import { ApiError } from "../../../lib/api";
import { getMe, updateMe, type User } from "../../../lib/auth";

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMe().then((r) => {
      setUser(r.user);
      setFirstName(r.user.firstName ?? "");
      setLastName(r.user.lastName ?? "");
      setPhone(r.user.phone ?? "");
    });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="text-sm text-zinc-600">View and update your account details.</p>
      </div>

      <div className="rounded-lg border bg-white p-5 space-y-4">
        <div className="text-sm text-zinc-600">
          Email: <span className="font-medium text-zinc-900">{user?.email}</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">First name</label>
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Last name</label>
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Phone</label>
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>

        {status ? <div className="text-sm text-zinc-600">{status}</div> : null}

        <button
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            setStatus(null);
            try {
              const r = await updateMe({
                firstName: firstName || null,
                lastName: lastName || null,
                phone: phone || null,
              });
              setUser(r.user);
              setStatus("Saved.");
            } catch (e) {
              setStatus(e instanceof ApiError ? e.message : "Failed to save");
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

