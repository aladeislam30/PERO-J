import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useTheme } from "../theme";

export default function Nav() {
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const { resolvedTheme, toggleTheme } = useTheme();

  function search(e: React.FormEvent) {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    // Stellar addresses start with G (56 chars); contract IDs are hex 64 chars
    if (v.startsWith("G") && v.length === 56) nav(`/wallet/${v}`);
    else nav(`/contract/${v}`);
    setQ("");
  }

  return (
    <header style={{
      background: "var(--surface)",
      borderBottom: "1px solid var(--border)",
      padding: "12px 24px",
      display: "flex",
      alignItems: "center",
      gap: 16,
    }}>
      <NavLink
        to="/"
        style={({ isActive }) => ({
          fontWeight: 700,
          fontSize: 16,
          whiteSpace: "nowrap",
          color: isActive ? "var(--accent)" : "inherit",
          borderBottom: isActive ? "2px solid var(--accent)" : "none",
          paddingBottom: isActive ? "4px" : "0px",
        })}
      >
        ⬡ Soroban Explorer
      </NavLink>
      <form onSubmit={search} style={{ display: "flex", gap: 8, flex: 1, maxWidth: 600 }}>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search contract ID or wallet address…"
          style={{ flex: 1 }}
        />
        <button type="submit">Search</button>
      </form>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: "auto" }}>
        <NavLink
          to="/settings"
          style={({ isActive }) => ({
            color: isActive ? "var(--accent-color)" : "var(--text-primary)",
            fontWeight: isActive ? 700 : 500,
            whiteSpace: "nowrap",
          })}
        >
          Settings
        </NavLink>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} theme`}
          title={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} theme`}
          style={{
            background: "transparent",
            color: "var(--text-primary)",
            border: "1px solid var(--border-color)",
            padding: "6px 8px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 0,
          }}
        >
          {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </header>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  );
}
