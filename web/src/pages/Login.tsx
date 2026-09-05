import axios from "axios";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import fieldBg from "../assets/photos/field-wide.jpg";
import { API_BASE } from "../api/client";
import { useAuth } from "../lib/auth";

const DEMO = [
  { username: "keshav", label: "Keshav Jha", role: "Admin · Mine Manager" },
  { username: "prince", label: "Prince", role: "Safety Officer" },
  { username: "rana", label: "Rana", role: "Mine Manager · Jhanjra" },
  { username: "khadir", label: "Khadir", role: "Safety Officer · Jhanjra" },
  { username: "nisarga", label: "Nisarga", role: "Regulator · all mines" },
];

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("keshav");
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
    } catch (err) {
      // Only a 401 is actually a credentials problem. Reporting a dead API or
      // a stopped database as "wrong password" sends you hunting for the wrong
      // bug — say what really failed.
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;

      if (status === 401) {
        setError("Incorrect username or password.");
      } else if (status === undefined) {
        setError(
          `Cannot reach the API at ${API_BASE}. Is uvicorn running on port 8000?`,
        );
      } else if (status >= 500) {
        setError(
          `The API returned ${status}. Its database is usually the cause — check that the anupalan-db container is running.`,
        );
      } else {
        setError(`Sign-in failed (HTTP ${status}).`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    // An Indian open-cast coalfield, from Pexels (pexels-photo-17971746) under
    // the Pexels licence: free for commercial use, no attribution required,
    // no watermark. A government-facing tool should be able to account for the
    // provenance of every asset it ships, so it is recorded here rather than
    // in someone's memory. Cropped to 1800x620 at build time by hand so the
    // browser is not shipped 2520x1416 of pixels it will never draw.
    <div
      className="relative grid min-h-full place-items-center bg-cover bg-center px-4"
      style={{ backgroundImage: `url(${fieldBg})` }}
    >
      {/* A scrim. White type over a photograph is unreadable wherever the
          photograph happens to be pale, and this one has a bright sky. */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0f2942]/85 via-[#0f2942]/70 to-[#0f2942]/90" />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            ANUPALAN
          </h1>
          <p className="mt-1 text-sm text-slate-300">
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
