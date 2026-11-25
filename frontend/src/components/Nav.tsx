import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useWallet } from "../wallet/WalletProvider";
import { WalletSelectorModal } from "../wallet/WalletSelectorModal";
import NetworkStatusChip from "./NetworkStatusChip";
import { useTheme } from "../theme";

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export default function Nav() {
  const [q, setQ] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const nav = useNavigate();
  const { resolvedTheme, toggleTheme } = useTheme();
  const { address, providerName, status } = useWallet();

  function search(e: React.FormEvent) {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    if (v.startsWith("G") && v.length === 56) nav(`/wallet/${v}`);
    else nav(`/contract/${v}`);
    setQ("");
    setMenuOpen(false);
  }

  const walletLabel = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : status === "connecting"
      ? "Connecting…"
      : "Connect wallet";

  const linkStyle = (isActive: boolean) => ({
    fontWeight: 600,
    fontSize: 15,
    whiteSpace: "nowrap" as const,
    color: isActive ? "var(--accent)" : "inherit",
    borderBottom: isActive ? "2px solid var(--accent)" : "none",
    paddingBottom: isActive ? "4px" : "0px",
  });

  return (
<<<<<<< HEAD
    <>
      <header className="nav-header">
        <div className="nav-bar">
          <NavLink to="/" style={{ fontWeight: 700, fontSize: 18, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6 }}>
            ⬡ Soroban Explorer
=======
    <header className="nav-header">
      <div className="nav-bar">
        <NavLink
          to="/"
          onClick={() => setMenuOpen(false)}
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
        <button
          type="button"
          className="nav-toggle"
          aria-label="Toggle navigation menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          ☰
        </button>
        <nav className={`nav-links${menuOpen ? " open" : ""}`}>
          <NavLink to="/markets" onClick={() => setMenuOpen(false)} style={({ isActive }) => linkStyle(isActive)}>
            Markets
          </NavLink>
          <NavLink to="/profile" onClick={() => setMenuOpen(false)} style={({ isActive }) => linkStyle(isActive)}>
            Profile
          </NavLink>
          <NavLink to="/contracts" onClick={() => setMenuOpen(false)} style={({ isActive }) => linkStyle(isActive)}>
            Contracts
>>>>>>> pr-1228
          </NavLink>
          <button
            type="button"
            className="nav-toggle"
            aria-label="Toggle navigation menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span aria-hidden="true">☰</span>
          </button>
          <nav id="primary-navigation" aria-label="Primary" className={`nav-links${menuOpen ? " open" : ""}`}>
            <NavLink to="/contracts" onClick={() => setMenuOpen(false)} style={({ isActive }) => linkStyle(isActive)}>
              Contracts
            </NavLink>
            <NavLink to="/referrals" onClick={() => setMenuOpen(false)} style={({ isActive }) => linkStyle(isActive)}>
              Referrals
            </NavLink>
            <NavLink to="/settings" onClick={() => setMenuOpen(false)} style={({ isActive }) => linkStyle(isActive)}>
              Settings
            </NavLink>
            <form onSubmit={search} className="nav-search" role="search">
              <label htmlFor="nav-search-input" className="sr-only">
                Search contract ID or wallet address
              </label>
              <input
                id="nav-search-input"
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search contract ID or wallet address…"
                style={{ flex: 1, minWidth: 0 }}
              />
              <button type="submit">Search</button>
            </form>
            <NetworkStatusChip sseUrl="/api/events/stream" />
            <button
              type="button"
              className="wallet-nav-button"
              title={address && providerName ? `${providerName}: ${address}` : "Connect a Stellar wallet"}
              aria-label={address && providerName ? `${providerName} wallet ${address}` : "Connect a Stellar wallet"}
              onClick={() => setWalletModalOpen(true)}
            >
              {address ? "◉" : "＋"} {walletLabel}
            </button>
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
                borderRadius: 6,
              }}
            >
              {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
          </nav>
        </div>
      </header>
      <WalletSelectorModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
    </>
  );
}
