"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Suspense } from "react";
import { ApiError } from "../../lib/api";
import { login, register } from "../../lib/auth";

function LoginInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") ?? "/dashboard";

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <div className="min-h-full flex items-center justify-center bg-zinc-50 px-4 py-12">
      <div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-sm">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Designs CRM</h1>
          <p className="text-sm text-zinc-600">
            {mode === "login" ? "Sign in to continue." : "Create your client account."}
          </p>
        </div>

        <div className="mt-6 space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Email</label>
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Password</label>
            <input
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>

          {error ? <div className="text-sm text-red-600">{error}</div> : null}

          <button
            className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            disabled={loading}
            onClick={async () => {
              setError(null);
              setLoading(true);
              try {
                if (mode === "register") await register(email, password);
                await login(email, password);
                router.replace(next);
              } catch (e) {
                if (e instanceof ApiError) setError(e.message);
                else setError("Something went wrong");
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>

          <button
            className="w-full rounded-md border px-3 py-2 text-sm hover:bg-zinc-50"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            disabled={loading}
          >
            {mode === "login" ? "Need an account? Register" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-full flex items-center justify-center bg-zinc-50 px-4 py-12">
          <div className="text-sm text-zinc-500">Loading…</div>
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}

