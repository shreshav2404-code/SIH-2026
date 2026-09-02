import { FileCheck2, LayoutDashboard, Map, Table2 } from "lucide-react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./lib/auth";
import Ledger from "./pages/Ledger";
import Login from "./pages/Login";
import MapView from "./pages/MapView";
import Overview from "./pages/Overview";
import Returns from "./pages/Returns";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/ledger", label: "Ledger", icon: Table2 },
  { to: "/map", label: "Map", icon: Map },
  { to: "/returns", label: "Returns", icon: FileCheck2 },
];

const ROLE_LABEL: Record<string, string> = {
  mine_manager: "Mine Manager",
  safety_officer: "Safety Officer",
  regulator: "Regulator",
};

function Shell() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-full">
      <header className="border-b border-[var(--line)] bg-[var(--panel)]">
        <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-5 py-3">
          <div>
            <span className="text-base font-semibold tracking-tight">
              ANUPALAN
            </span>
            <span className="ml-2 text-xs text-[var(--ink-soft)]">
              Coal India · compliance
            </span>
          </div>

          <nav className="flex items-center gap-1">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm ${
                    isActive
                      ? "bg-slate-100 font-medium text-[var(--ink)]"
                      : "text-[var(--ink-soft)] hover:bg-slate-50"
                  }`
                }
              >
                <Icon size={15} />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3 text-xs">
            <div className="text-right">
              <div className="font-medium">{user?.full_name}</div>
              <div className="text-[var(--ink-soft)]">
                {ROLE_LABEL[user?.role ?? ""] ?? user?.role}
              </div>
            </div>
            <button
              onClick={logout}
              className="rounded border border-[var(--line)] px-2 py-1 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-5 py-5">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/map" element={<MapView />} />
          <Route path="/returns" element={<Returns />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading)
    return (
      <div className="grid min-h-full place-items-center text-sm text-[var(--ink-soft)]">
        Connecting to the API…
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
