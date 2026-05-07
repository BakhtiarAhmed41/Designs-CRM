"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
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
    <div className="flex min-h-full items-center justify-center px-4 py-14">
      <div className="crm-surface w-full max-w-md p-8">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.55)]"
            aria-hidden
          />
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900">Designs CRM</h1>
        </div>
        <p className="crm-page-desc">
          {mode === "login" ? "Sign in to continue." : "Create your client account."}
        </p>

        <div className="mt-8 space-y-4">
          <div>
            <label className="crm-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="crm-field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div>
            <label className="crm-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="crm-field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>

          {error ? <div className="crm-alert-error">{error}</div> : null}

          <button
            type="button"
            className="crm-btn-primary w-full py-2.5"
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
                else if (e instanceof Error) setError(e.message);
                else setError("Something went wrong");
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>

          <button
            type="button"
            className="crm-btn-secondary w-full py-2.5"
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
        <div className="flex min-h-full items-center justify-center px-4 py-14">
          <div className="text-sm font-medium text-zinc-500">Loading…</div>
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}
