import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Activity, Box, Database, Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const nav = [
  { to: "/datasets", label: "Datasets", icon: Database },
  { to: "/models", label: "Models", icon: Box, soon: true },
  { to: "/production", label: "Production", icon: Activity, soon: true },
];

export default function Layout() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">mlops</div>
        <div className="nav-label">workspace</div>
        {nav.map(({ to, label, icon: Icon, soon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
            <Icon size={16} strokeWidth={1.6} aria-hidden="true" />
            {label}
            {soon && <span className="soon">soon</span>}
          </NavLink>
        ))}
        <div className="sidebar-foot">
          <button
            className="btn ghost small"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
