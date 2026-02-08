"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Login failed.");
        return;
      }

      let nextPath = "/admin";
      if (typeof window !== "undefined") {
        const next = new URLSearchParams(window.location.search).get("next");
        if (next && next.startsWith("/")) {
          nextPath = next;
        }
      }

      router.replace(nextPath);
      router.refresh();
    } catch {
      setError("Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16 space-y-6">
      <header className="space-y-2">
        <h1 className="text-lg font-semibold tracking-tight">Admin Login</h1>
        <p className="text-sm text-neutral-600">Enter admin password to continue.</p>
      </header>

      <form onSubmit={onSubmit} className="space-y-3">
        <label className="grid gap-1">
          <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Password</span>
          <input
            type="password"
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-10 border border-neutral-300 px-3"
            required
          />
        </label>

        {error ? <p className="text-xs text-red-600">{error}</p> : null}

        <button
          type="submit"
          className="h-10 border border-neutral-300 px-4 text-sm font-semibold hover:bg-neutral-50 disabled:opacity-50"
          disabled={submitting}
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
