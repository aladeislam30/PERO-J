import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useWallet } from "../wallet/WalletProvider";
import { WalletSelectorModal } from "../wallet/WalletSelectorModal";

export default function Nav() {
  const [q, setQ] = useState("");
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const nav = useNavigate();
  const { address, providerName, status } = useWallet();

  function search(e: React.FormEvent) {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    // Stellar addresses start with G (56 chars); contract IDs are hex 64 chars
    if (v.startsWith("G") && v.length === 56) nav(`/wallet/${v}`);
    else nav(`/contract/${v}`);
    setQ("");
  }

  const walletLabel = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : status === "connecting"
      ? "Connecting…"
      : "Connect wallet";

  return (
    <>
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
        <button
          type="button"
          className="wallet-nav-button"
          title={address && providerName ? `${providerName}: ${address}` : "Connect a Stellar wallet"}
          aria-label={address && providerName ? `${providerName} wallet ${address}` : "Connect a Stellar wallet"}
          onClick={() => setWalletModalOpen(true)}
        >
          {address ? "◉" : "＋"} {walletLabel}
        </button>
      </header>
      <WalletSelectorModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
    </>
  );
}
