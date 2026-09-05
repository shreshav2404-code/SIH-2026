import {
  BookText,
  Brain,
  Camera,
  FileCheck2,
  LayoutDashboard,
  Activity,
  Map,
  Table2,
} from "lucide-react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./lib/auth";
import { Headframe } from "./lib/brand";
import Ledger from "./pages/Ledger";
import Login from "./pages/Login";
import MapView from "./pages/MapView";
import Overview from "./pages/Overview";
import Evidence from "./pages/Evidence";
import FineTune from "./pages/FineTune";
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

function Shell() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-full">
      {/* Dark bar, carrying the same navy as the login screen so the product
          has one identity rather than two. It also buys contrast the old white
          strip never had: on a projector, pale grey nav text on white was the
          first thing to disappear. */}
      <header className="bg-[#0f2942] text-white shadow-sm">
        <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-5 py-2.5">
          <div className="flex items-center gap-2.5">
            <Headframe size={26} className="text-sky-300" />
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tight">
                ANUPALAN
              </div>
              <div className="text-[10.5px] tracking-wide text-sky-200/70 uppercase">
                Coal India · compliance
              </div>
            </div>
          </div>

          <nav className="flex items-center gap-0.5">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                    isActive
                      ? "bg-white/15 font-medium text-white"
                      : "text-sky-100/70 hover:bg-white/10 hover:text-white"
                  }`
                }
              >
                <Icon size={15} />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3 text-xs">
            <div className="text-right leading-tight">
              <div className="font-medium">{user?.full_name}</div>
              <div className="text-sky-200/70">
                {ROLE_LABEL[user?.role ?? ""] ?? user?.role}
              </div>
            </div>
            <button
              onClick={logout}
              className="rounded-md border border-white/25 px-2.5 py-1 transition-colors hover:bg-white/15"
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
          <Route path="/rulebook" element={<Rulebook />} />
          <Route path="/sensors" element={<Sensors />} />
          <Route path="/map" element={<MapView />} />
          <Route path="/evidence" element={<Evidence />} />
          <Route path="/returns" element={<Returns />} />
          <Route path="/finetune" element={<FineTune />} />
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
