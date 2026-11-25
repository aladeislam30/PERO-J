import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { StrKey } from "@stellar/stellar-sdk";
import { api } from "../api";
import { useBets } from "../bets/BetsContext";
import BetRow from "../bets/BetRow";
import EventTable from "../components/EventTable";
import Skeleton from "../components/Skeleton";

type WalletId = "freighter" | "xbull" | "albedo" | "lobstr" | "walletconnect";

interface WalletOption {
  id: WalletId;
  name: string;
  icon: string;
  guide: string;
  installUrl: string;
}

const WALLETS: WalletOption[] = [
  {
    id: "freighter",
    name: "Freighter",
    icon: "🚀",
    guide: "Install the Freighter browser extension, then unlock it and approve the connection request.",
    installUrl: "https://www.freighter.app/",
  },
  {
    id: "xbull",
    name: "xBull",
    icon: "🐂",
    guide: "Install the xBull extension or mobile app, then approve the connection request.",
    installUrl: "https://xbull.app/",
  },
  {
    id: "albedo",
    name: "Albedo",
    icon: "🛡️",
    guide: "Albedo is a web-based signer — no install needed. Approve the connection in the popup.",
    installUrl: "https://albedo.link/",
  },
  {
    id: "lobstr",
    name: "Lobstr",
    icon: "🦞",
    guide: "Use the Lobstr mobile app or extension and approve the connection request.",
    installUrl: "https://lobstr.co/",
  },
  {
    id: "walletconnect",
    name: "WalletConnect",
    icon: "🔗",
    guide: "Scan the WalletConnect QR code with a compatible mobile wallet to connect.",
    installUrl: "https://walletconnect.com/",
  },
];

const STORAGE_KEY = "soroban-explorer:wallet-provider";

type ProfileTab = "history" | "bonds";

type BondStatus = "escrowed" | "returned" | "slashed";

interface BondPosition {
  id: string;
  marketTitle: string;
  role: "submitter" | "challenger";
  amount: number;
  status: BondStatus;
  txHash: string;
}

const BOND_STATUS_META: Record<BondStatus, { label: string; color: string; background: string }> = {
  escrowed: { label: "Escrowed", color: "#8a6d00", background: "rgba(255, 196, 0, 0.15)" },
  returned: { label: "Returned with reward", color: "#1a7f37", background: "rgba(46, 160, 67, 0.15)" },
  slashed: { label: "Slashed", color: "#c62828", background: "rgba(229, 72, 77, 0.15)" },
};

function normalizeBondStatus(status: unknown): BondStatus {
  const s = String(status ?? "").toLowerCase();
  if (s.includes("slash")) return "slashed";
  if (s.includes("return") || s.includes("reward") || s.includes("claim")) return "returned";
  return "escrowed";
}

function normalizeBonds(raw: unknown): BondPosition[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.bonds)
    ? (raw as any).bonds
    : Array.isArray((raw as any)?.data)
    ? (raw as any).data
    : [];
  return list.map((b: any, i: number) => ({
    id: String(b.id ?? b.bond_id ?? b.bondId ?? `${b.tx_hash ?? b.txHash ?? i}-${i}`),
    marketTitle: String(b.market_title ?? b.marketTitle ?? b.market ?? b.title ?? "Unknown market"),
    role: String(b.role ?? "").toLowerCase().includes("challeng") ? "challenger" : "submitter",
    amount: Number(b.amount ?? b.bond_amount ?? b.bondAmount ?? 0),
    status: normalizeBondStatus(b.status ?? b.state),
    txHash: String(b.tx_hash ?? b.txHash ?? b.transaction_hash ?? ""),
  }));
}

function getInjectedProvider(id: WalletId): any | null {
  const w = window as any;
  switch (id) {
    case "freighter":
      return w.freighterApi ?? w.freighter ?? null;
    case "xbull":
      return w.xBull ?? w.xbull ?? null;
    case "albedo":
      return w.albedo ?? null;
    case "lobstr":
      return w.lobstr ?? null;
    case "walletconnect":
      return w.ethereum ?? null;
    default:
      return null;
  }
}

export default function WalletPage() {
  const { address = "" } = useParams();
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState(address);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<ProfileTab>("history");

  const [selectorOpen, setSelectorOpen] = useState(false);
  const [activeWallet, setActiveWallet] = useState<WalletId | null>(null);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<WalletId | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  useEffect(() => {
    document.title = address
      ? `Wallet ${address} - Soroban Smart Block Explorer`
      : "Wallet History - Soroban Smart Block Explorer";
  }, [address]);

  const connectWallet = useCallback(async (id: WalletId) => {
    setWalletError(null);
    setConnecting(id);
    try {
      const provider = getInjectedProvider(id);
      if (!provider) {
        const option = WALLETS.find(w => w.id === id);
        throw new Error(
          `${option?.name ?? id} is not installed. ${option?.guide ?? ""}`.trim()
        );
      }
      let publicKey: string | null = null;
      if (typeof provider.requestAccess === "function") {
        publicKey = await provider.requestAccess();
      } else if (typeof provider.connect === "function") {
        const res = await provider.connect();
        publicKey = typeof res === "string" ? res : res?.publicKey ?? null;
      } else if (typeof provider.getPublicKey === "function") {
        publicKey = await provider.getPublicKey();
      }
      if (!publicKey) {
        throw new Error("Wallet did not return a public key.");
      }
      setActiveWallet(id);
      setConnectedAddress(publicKey);
      localStorage.setItem(STORAGE_KEY, id);
      setSelectorOpen(false);
      navigate(`/wallet/${publicKey}`);
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : "Failed to connect wallet.");
    } finally {
      setConnecting(null);
    }
  }, [navigate]);

  // Auto-reconnect to the previously chosen wallet provider.
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as WalletId | null;
    if (saved && WALLETS.some(w => w.id === saved)) {
      void connectWallet(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isValidAddress = StrKey.isValidEd25519PublicKey(address);

  const { data, isLoading } = useQuery({
    queryKey: ["wallet", address, page],
    queryFn: () => api.wallet(address, page),
    enabled: !!address && isValidAddress,
  });

  const events = data?.events ?? [];
  const total = data?.total ?? 0;

  // Escape key handler for wallet selector modal
  useEffect(() => {
    if (!selectorOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectorOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectorOpen]);
  const limit = data?.limit ?? 25;

  const {
    data: bondsData,
    isLoading: bondsLoading,
    isError: bondsError,
  } = useQuery({
    queryKey: ["wallet-bonds", address],
    queryFn: () => api.getBonds(address),
    enabled: !!address && isValidAddress && tab === "bonds",
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  const bonds = useMemo(() => normalizeBonds(bondsData), [bondsData]);

  const { pendingBets } = useBets();
  const optimisticBets = useMemo(
    () =>
      pendingBets.filter(
        (bet) =>
          bet.address === address &&
          !events.some((ev) => ev.tx_hash && ev.tx_hash === bet.txHash)
      ),
    [address, events, pendingBets]
  );

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (searchInput.trim()) {
      navigate(`/wallet/${searchInput.trim()}`);
      setPage(1);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="card">
        <h2 style={{ marginBottom: 12 }}>Wallet History</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setSelectorOpen(true)}>
            {connectedAddress ? "Switch Wallet" : "Connect Wallet"}
          </button>
          {connectedAddress && (
            <code style={{ fontSize: 12, color: "var(--muted)", wordBreak: "break-all" }}>
              {activeWallet ? `${WALLETS.find(w => w.id === activeWallet)?.name}: ` : ""}
              {connectedAddress}
            </code>
          )}
        </div>
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            placeholder="Enter Stellar address"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            style={{ flex: 1, padding: "8px 12px", borderRadius: 4, border: "1px solid var(--border)", fontFamily: "monospace", fontSize: 12 }}
          />
          <button type="submit">Search</button>
        </form>
        {address && <code style={{ fontSize: 12, color: "var(--muted)", wordBreak: "break-all" }}>{address}</code>}
      </div>

      <div className="card">
        <div role="tablist" aria-label="Profile sections" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "history"}
            onClick={() => setTab("history")}
            style={{ fontWeight: tab === "history" ? 700 : 400 }}
          >
            History
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "bonds"}
            onClick={() => setTab("bonds")}
            style={{ fontWeight: tab === "bonds" ? 700 : 400 }}
          >
            Oracle Bonds
          </button>
        </div>

        {!address
          ? <p style={{ color: "var(--muted)" }}>Enter a Stellar address to view wallet history.</p>
          : !isValidAddress
          ? <p style={{ color: "var(--muted)" }}>Invalid Stellar address.</p>
          : tab === "bonds"
          ? <>
              {bondsLoading
                ? <Skeleton />
                : bondsError
                ? <p style={{ color: "var(--muted)" }}>Failed to load oracle bonds.</p>
                : bonds.length === 0
                ? <p style={{ color: "var(--muted)" }}>No oracle bonds found for this address.</p>
                : <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                          <th style={{ padding: "8px 10px" }}>Market</th>
                          <th style={{ padding: "8px 10px" }}>Role</th>
                          <th style={{ padding: "8px 10px" }}>Bond (XLM)</th>
                          <th style={{ padding: "8px 10px" }}>Status</th>
                          <th style={{ padding: "8px 10px" }}>Transaction</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bonds.map((bond) => {
                          const meta = BOND_STATUS_META[bond.status];
                          return (
                            <tr key={bond.id} style={{ borderBottom: "1px solid var(--border)" }}>
                              <td style={{ padding: "8px 10px" }}>{bond.marketTitle}</td>
                              <td style={{ padding: "8px 10px", textTransform: "capitalize" }}>{bond.role}</td>
                              <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{bond.amount.toLocaleString()}</td>
                              <td style={{ padding: "8px 10px" }}>
                                <span
                                  style={{
                                    display: "inline-block",
                                    padding: "2px 8px",
                                    borderRadius: 999,
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: meta.color,
                                    background: meta.background,
                                  }}
                                >
                                  {meta.label}
                                </span>
                              </td>
                              <td style={{ padding: "8px 10px" }}>
                                {bond.txHash ? (
                                  <a
                                    href={`https://stellar.expert/explorer/testnet/tx/${bond.txHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ fontFamily: "monospace", fontSize: 12 }}
                                  >
                                    {bond.txHash.slice(0, 8)}…{bond.txHash.slice(-6)}
                                  </a>
                                ) : (
                                  <span style={{ color: "var(--muted)" }}>—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>}
            </>
          : <>
              {optimisticBets.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {optimisticBets.map((bet) => (
                    <BetRow key={bet.id} bet={bet} />
                  ))}
                </div>
              )}
              {isLoading
                ? <Skeleton />
                : <EventTable
                  events={events}
                  emptyMessage="No events found for this address."
                  emptySubtitle="This address has no indexed events."
                />}
            </>}
      </div>

      {/* Pagination */}
      {isValidAddress && tab === "history" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)} aria-label="Previous page">← Prev</button>
          <span style={{ padding: "6px 10px", color: "var(--muted)" }}>Page {page}</span>
          {/* Disable Next only when all events have been fetched.
              Checking page * limit >= total (not events.length < limit)
              avoids prematurely disabling the button when the last page
              is exactly full (total % limit === 0). */}
          <button disabled={page * limit >= total} onClick={() => setPage(p => p + 1)} aria-label="Next page">Next →</button>
        </div>
      )}

      {selectorOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Select a Stellar wallet"
          onClick={() => setSelectorOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            className="card"
            onClick={e => e.stopPropagation()}
            style={{ width: "min(420px, 92vw)", display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Connect a Wallet</h3>
              <button type="button" onClick={() => setSelectorOpen(false)} aria-label="Close wallet selection">✕</button>
            </div>
            {walletError && (
              <p style={{ color: "var(--danger, #e5484d)", fontSize: 12, margin: 0 }}>{walletError}</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {WALLETS.map(w => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => void connectWallet(w.id)}
                  disabled={connecting !== null}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 12px",
                    textAlign: "left",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    background: "transparent",
                    cursor: connecting !== null ? "wait" : "pointer",
                  }}
                >
                  <span style={{ fontSize: 22 }} aria-hidden="true">{w.icon}</span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <strong style={{ fontSize: 14 }}>
                      {w.name}{connecting === w.id ? " — connecting…" : ""}
                    </strong>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{w.guide}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
