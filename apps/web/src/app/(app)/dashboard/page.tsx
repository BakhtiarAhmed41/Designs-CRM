"use client";

import { useEffect, useState } from "react";
import { getMe, type User } from "../../../lib/auth";

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    getMe().then((r) => setUser(r.user));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-zinc-600">Phase 1 foundation: auth + profile.</p>
      </div>

      <div className="rounded-lg border bg-white p-5">
        <div className="text-sm text-zinc-600">Signed in as</div>
        <div className="mt-1 font-medium">{user?.email}</div>
        <div className="mt-2 text-sm text-zinc-600">
          Role: <span className="font-medium text-zinc-900">{user?.role}</span>
        </div>
      </div>
    </div>
  );
}

