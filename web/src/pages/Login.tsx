import axios from "axios";
import { Check, Fingerprint, Loader2, Lock, ShieldCheck, User, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import fieldBg from "../assets/photos/field-wide.jpg";
import { API_BASE } from "../api/client";
import { useAuth } from "../lib/auth";
import { Headframe } from "../lib/brand";
import { EASE, item, stagger } from "../lib/motion";
import { TerrainBackdrop } from "../lib/three";

/**
 * The five team logins. The role beside each name is a DESIGNATION - the job
 * title that person holds and that the dashboard shows against their actions -
 * not a permission level. All five share one mine's register and all five can
 * do everything in it, so nobody has to swap logins mid-answer.
 *
 * Production would not look like this, and auth.py says where to narrow it.
 */
const DEMO = [
  { username: "keshav", label: "Keshav Jha", role: "Mine Manager" },
  { username: "prince", label: "Prince", role: "Safety Officer" },
  { username: "rana", label: "Rana", role: "Mine Manager" },
  { username: "khadir", label: "Khadir", role: "Safety Officer" },
  { username: "nisarga", label: "Nisarga", role: "Regulator" },
];

const POINTS = [
  { icon: WifiOff, text: "Field capture works underground, with no signal" },
  { icon: Fingerprint, text: "Every photograph hash-chained the moment it is taken" },
  { icon: ShieldCheck, text: "Duties cited to the OSH Code 2020 and CMR 2017" },
];

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("keshav");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

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
        setError(`Cannot reach the API at ${API_BASE}. Is the API running?`);
      } else if (status >= 500) {
        setError(
          `The API returned ${status}. Its database is usually the cause — check that the anupalan-db container is running.`,
        );
      } else {
        setError(`Sign-in failed (HTTP ${status}).`);
      }
      setAttempt((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    // An Indian open-cast coalfield, from Pexels (pexels-photo-17971746) under
    // the Pexels licence: free for commercial use, no attribution required,
    // no watermark. A government-facing tool should be able to account for the
    // provenance of every asset it ships, so it is recorded here rather than
    // in someone's memory. It now sits faintly under a live 3D survey drawing
    // of a coalfield (lib/three/TerrainScene), and is the whole background
    // wherever WebGL is unavailable.
    <div className="relative isolate min-h-full overflow-hidden bg-[var(--night-950)] text-white">
      <div className="absolute inset-0 bg-cover bg-center opacity-20" style={{ backgroundImage: `url(${fieldBg})` }} />
      <TerrainBackdrop variant="login" />
      {/* Scrim: the form must stay legible wherever the landscape is bright. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_70%_40%,transparent_0%,rgb(5_13_26/0.55)_55%,rgb(5_13_26/0.92)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[var(--night-950)] to-transparent" />

      <div className="relative mx-auto grid min-h-full max-w-6xl items-center gap-10 px-6 py-10 lg:grid-cols-[1.1fr_420px]">
        <motion.div variants={stagger} initial="hidden" animate="show" className="hidden lg:block">
          <motion.div variants={item} className="flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-sky-400/25 to-blue-600/10 ring-1 ring-sky-300/30 backdrop-blur-sm">
              <Headframe size={30} className="text-sky-300" />
            </span>
            <span className="text-[13px] font-semibold tracking-[0.24em] text-sky-200/80 uppercase">
              NeuraForge · SIH 2026
            </span>
          </motion.div>
          <motion.h1
            variants={item}
            className="mt-6 text-[64px] leading-[0.95] font-semibold tracking-[-0.03em]"
          >
            ANUPALAN
          </motion.h1>
          <motion.p variants={item} className="mt-4 max-w-md text-[17px] leading-relaxed text-sky-100/75">
            Statutory compliance for Coal India, checked continuously - from the
            pit face to the regulator's desk.
          </motion.p>
          <motion.ul variants={stagger} className="mt-8 grid max-w-md gap-3">
            {POINTS.map(({ icon: Icon, text }) => (
              <motion.li
                key={text}
                variants={item}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-[13.5px] text-sky-50/90 backdrop-blur-sm"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sky-400/15 text-sky-300">
                  <Icon size={16} />
                </span>
                {text}
              </motion.li>
            ))}
          </motion.ul>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.15 }}
          className="w-full"
        >
          <div className="mb-5 text-center lg:hidden">
            <Headframe size={36} className="mx-auto text-sky-300" />
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">ANUPALAN</h1>
            <p className="mt-1 text-sm text-sky-100/70">Compliance monitoring · Coal India</p>
          </div>

          <motion.form
            key={attempt}
            onSubmit={submit}
            animate={attempt ? { x: [0, -10, 9, -6, 4, 0] } : undefined}
            transition={{ duration: 0.45 }}
            className="rounded-3xl border border-white/15 bg-white/[0.92] p-6 text-[var(--ink)] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.6)] backdrop-blur-xl"
          >
            <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
            <p className="mt-0.5 text-[13px] text-[var(--ink-soft)]">Use your mine credentials.</p>

            <label className="mt-5 block text-[12px] font-medium text-[var(--ink-soft)]">
              Username
              <span className="relative mt-1.5 block">
                <User size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
                <input
                  className="h-11 w-full rounded-xl border border-[var(--line)] bg-white pr-3 pl-9 text-[14px] text-[var(--ink)] outline-none focus:border-[var(--accent)]"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                />
              </span>
            </label>

            <label className="mt-3 block text-[12px] font-medium text-[var(--ink-soft)]">
              Password
              <span className="relative mt-1.5 block">
                <Lock size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  className="h-11 w-full rounded-xl border border-[var(--line)] bg-white pr-3 pl-9 text-[14px] text-[var(--ink)] outline-none focus:border-[var(--accent)]"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </span>
            </label>

            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-3 overflow-hidden rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-800"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <button
              disabled={busy}
              className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] text-[14px] font-semibold text-white disabled:opacity-70"
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </motion.form>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.06] p-3 backdrop-blur-md">
            <p className="mb-2 px-1 text-[10.5px] font-semibold tracking-[0.14em] text-sky-100/70 uppercase">
              Demo accounts · password demo1234
            </p>
            <motion.div className="grid gap-1" variants={stagger} initial="hidden" animate="show">
              {DEMO.map((d) => {
                const active = d.username === username;
                return (
                  <motion.button
                    key={d.username}
                    type="button"
                    variants={item}
                    whileHover={{ x: 3 }}
                    onClick={() => setUsername(d.username)}
                    className={`relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[13px] ${
                      active ? "text-white" : "text-sky-50/80 hover:bg-white/[0.06]"
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="demo-pick"
                        className="absolute inset-0 rounded-xl bg-sky-400/15 ring-1 ring-sky-300/30"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    <span className="relative grid size-7 place-items-center rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 text-[10.5px] font-bold text-white">
                      {d.label
                        .split(/\s+/)
                        .map((p) => p[0])
                        .join("")
                        .slice(0, 2)}
                    </span>
                    <span className="relative flex-1 font-medium">{d.label}</span>
                    <span className="relative text-[12px] text-sky-100/60">{d.role}</span>
                    {active && <Check size={14} className="relative text-sky-300" />}
                  </motion.button>
                );
              })}
            </motion.div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
