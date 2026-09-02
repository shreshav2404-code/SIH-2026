import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../lib/auth";

const DEMO = [
  { username: "manager.gevra", label: "P. Kujur", role: "Mine Manager" },
  { username: "safety.gevra", label: "R. Minz", role: "Safety Officer" },
  { username: "regulator.dgms", label: "DGMS", role: "Regulator" },
];

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("manager.gevra");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      nav("/");
    } catch {
      setError("Incorrect username or password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">ANUPALAN</h1>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            Compliance monitoring · Coal India
          </p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5"
        >
          <label className="block text-xs font-medium text-[var(--ink-soft)]">
            Username
            <input
              className="mt-1 w-full rounded border border-[var(--line)] px-2.5 py-2 text-sm outline-none focus:border-[var(--accent)]"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </label>

          <label className="mt-3 block text-xs font-medium text-[var(--ink-soft)]">
            Password
            <input
              type="password"
              className="mt-1 w-full rounded border border-[var(--line)] px-2.5 py-2 text-sm outline-none focus:border-[var(--accent)]"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>

          {error && <p className="mt-3 text-xs text-red-700">{error}</p>}

          <button
            disabled={busy}
            className="mt-4 w-full rounded bg-[var(--accent)] py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--ink-soft)]">
            Demo accounts · password demo1234
          </p>
          <div className="grid gap-1">
            {DEMO.map((d) => (
              <button
                key={d.username}
                onClick={() => setUsername(d.username)}
                className="flex items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-slate-50"
              >
                <span className="font-medium">{d.label}</span>
                <span className="text-[var(--ink-soft)]">{d.role}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
