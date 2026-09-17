import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BookText,
  Brain,
  Camera,
  FileCheck2,
  LayoutDashboard,
  LogOut,
  Map,
  Table2,
} from "lucide-react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";

import { api } from "./api/client";
import { useAuth } from "./lib/auth";
import { Headframe } from "./lib/brand";
import { EASE, page } from "./lib/motion";
import ReportViewer from "./lib/ReportViewer";
import Evidence from "./pages/Evidence";
import FineTune from "./pages/FineTune";
import Ledger from "./pages/Ledger";
import Login from "./pages/Login";
import MapView from "./pages/MapView";
import Overview from "./pages/Overview";
import Returns from "./pages/Returns";
import Rulebook from "./pages/Rulebook";
import Sensors from "./pages/Sensors";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/ledger", label: "Ledger", icon: Table2 },
  { to: "/rulebook", label: "Rulebook", icon: BookText },
  { to: "/evidence", label: "Evidence", icon: Camera },
  { to: "/sensors", label: "Sensors", icon: Activity },
  { to: "/map", label: "Map", icon: Map },
  { to: "/returns", label: "Returns", icon: FileCheck2 },
  { to: "/finetune", label: "Fine-tune", icon: Brain },
];

const ROLE_LABEL: Record<string, string> = {
  mine_manager: "Mine Manager",
  safety_officer: "Safety Officer",
  regulator: "Regulator",
};

/** Is the API answering? Shown in the bar so a dead backend is obvious before a table looks empty. */
function ApiStatus() {
  const { data, isError } = useQuery({
    queryKey: ["health"],
    queryFn: async () => (await api.get<{ status: string; db: string }>("/health")).data,
    refetchInterval: 15_000,
  });
  const live = !isError && data?.status === "ok" && data.db === "ok";
  return (
    <span
      className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium sm:inline-flex ${
        live
          ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
          : "border-red-400/30 bg-red-400/10 text-red-300"
      }`}
      title={live ? "API and database reachable" : "API or database not reachable"}
    >
      <span className={`size-1.5 rounded-full ${live ? "pulse-dot text-emerald-400" : "bg-red-400"}`} />
      {live ? "Live" : "Offline"}
    </span>
  );
}

function initials(name?: string) {
  return (name ?? "?")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function Shell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 8));

  // A new page starts at its top, not wherever the last one was scrolled to.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="min-h-full">
      {/* Dark glass, the same navy as the login and the heroes, so the
          product has one identity. It also buys contrast: on a projector,
          pale nav text on white was the first thing to disappear. */}
      <header
        className={`glass-dark sticky top-0 z-40 border-b border-[var(--night-line)] text-white transition-shadow duration-300 ${
          scrolled ? "shadow-[0_10px_30px_-12px_rgb(5_13_26/0.6)]" : ""
        }`}
      >
        <div
          className={`mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-5 gap-y-2 px-5 transition-[padding] duration-300 xl:flex-nowrap ${
            scrolled ? "py-1.5" : "py-2.5"
          }`}
        >
          <NavLink to="/" className="group flex shrink-0 items-center gap-2.5">
            <motion.span
              className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-sky-400/25 to-blue-600/10 ring-1 ring-sky-300/25"
              whileHover={{ rotate: -8, scale: 1.06 }}
              transition={{ type: "spring", stiffness: 300, damping: 15 }}
            >
              <Headframe size={22} className="text-sky-300" />
            </motion.span>
            <span className="leading-tight">
              <span className="block text-[15px] font-semibold tracking-[0.02em]">ANUPALAN</span>
              <span className="block text-[10px] font-medium tracking-[0.16em] text-[var(--night-soft)] uppercase">
                Coal India · compliance
              </span>
            </span>
          </NavLink>

          <nav
            className="order-last -mx-1 flex w-full min-w-0 items-center gap-0.5 overflow-x-auto px-1 [scrollbar-width:none] xl:order-none xl:w-auto [&::-webkit-scrollbar]:hidden"
            aria-label="Main"
          >
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `group relative flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    isActive ? "text-white" : "text-[var(--night-soft)] hover:text-white"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span
                        layoutId="nav-pill"
                        className="absolute inset-0 rounded-lg bg-white/[0.12] ring-1 ring-white/15"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    {isActive && (
                      <motion.span
                        layoutId="nav-glow"
                        className="absolute inset-x-3 bottom-0.5 h-[2px] rounded-full bg-gradient-to-r from-sky-400 to-blue-500 shadow-[0_0_12px_rgb(56_189_248/0.9)]"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    <Icon
                      size={15}
                      className={`relative transition-transform duration-300 group-hover:-translate-y-px ${
                        isActive ? "text-sky-300" : ""
                      }`}
                    />
                    <span className="relative">{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <ApiStatus />
            <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] py-1 pr-1 pl-1.5">
              <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 text-[11px] font-bold text-white shadow-inner">
                {initials(user?.full_name)}
              </span>
              <span className="hidden text-right leading-tight lg:block">
                <span className="block text-[12.5px] font-medium">{user?.full_name}</span>
                <span className="block text-[10.5px] text-[var(--night-soft)]">
                  {ROLE_LABEL[user?.role ?? ""] ?? user?.role}
                </span>
              </span>
              <motion.button
                onClick={logout}
                whileTap={{ scale: 0.94 }}
                title="Sign out"
                className="grid size-7 place-items-center rounded-lg text-[var(--night-soft)] hover:bg-white/10 hover:text-white"
              >
                <LogOut size={14} />
                <span className="sr-only">Sign out</span>
              </motion.button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 py-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={location.pathname} variants={page} initial="initial" animate="enter" exit="exit">
            <Routes location={location}>
              <Route path="/" element={<Overview />} />
              <Route path="/ledger" element={<Ledger />} />
              <Route path="/rulebook" element={<Rulebook />} />
              <Route path="/sensors" element={<Sensors />} />
              <Route path="/map" element={<MapView />} />
              <Route path="/evidence" element={<Evidence />} />
              <Route path="/returns" element={<Returns />} />
              <Route path="/finetune" element={<FineTune />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </main>
      <ReportViewer />
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading)
    return (
      <div className="grid min-h-full place-items-center bg-[var(--night-900)] text-sm text-[var(--night-soft)]">
        <motion.div
          className="flex flex-col items-center gap-3"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
        >
          <motion.span animate={{ rotate: [0, -6, 6, 0] }} transition={{ duration: 2, repeat: Infinity }}>
            <Headframe size={40} className="text-sky-300" />
          </motion.span>
          Connecting to the API…
        </motion.div>
      </div>
    );

  if (!user)
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );

  return <Shell />;
}
