import { Routes, Route, Link, NavLink } from "react-router-dom";
import CaseList from "./pages/CaseList.js";
import CaseDetail from "./pages/CaseDetail.js";
import ScenarioRunner from "./pages/ScenarioRunner.js";
import MetricsPage from "./pages/Metrics.js";

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-3 py-2 rounded text-sm font-medium ${
          isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
        }`
      }
    >
      {children}
    </NavLink>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-4">
          <Link to="/" className="font-semibold">
            AI Revenue Recovery
          </Link>
          <nav className="flex gap-1">
            <NavItem to="/">Cases</NavItem>
            <NavItem to="/scenarios">Scenario Runner</NavItem>
            <NavItem to="/metrics">Metrics</NavItem>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Routes>
          <Route path="/" element={<CaseList />} />
          <Route path="/cases/:id" element={<CaseDetail />} />
          <Route path="/scenarios" element={<ScenarioRunner />} />
          <Route path="/metrics" element={<MetricsPage />} />
        </Routes>
      </main>
    </div>
  );
}
