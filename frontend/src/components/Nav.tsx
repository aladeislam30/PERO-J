import { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import NetworkStatusChip from "./NetworkStatusChip";

/**
 * Reads the stored or system theme preference.
 * Priority: localStorage → system prefers-color-scheme → "light"
 */
function getInitialTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("theme") as "light" | "dark" | null;
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Applies the theme to the document root and persists to localStorage.
 */
function applyTheme(theme: "light" | "dark") {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
}

type WalletId = "freighter" | "xbull" | "albedo" | "lobstr" | "walletconnect";

interface WalletOption {
  id: WalletId;
  name: string;
  icon: string;
  guide: string;
}

const WALLETS: WalletOption[] = [
  {
    id: "freighter",
    name: "Freighter",
    icon: "🚀",
    guide: "Install the Freighter browser extension, then unlock it and approve the connection.",
  },
  {
    id: "xbull",
    name: "xBull",
    icon: "🐂",
    guide: "Install the xBull extension or mobile app, then approve the connection request.",
  },
  {
    id: "albedo",
    name: "Albedo",
    icon: "🛡️",
    guide: "Albedo is web-based — no install needed. Approve the connection in the popup.",
  },
  {
    id: "lobstr",
    name: "Lobstr",
    icon: "🦞",
    guide: "Use the Lobstr mobile app and scan the WalletConnect QR code to connect.",
  },
  {
    id: "walletconnect",
    name: "WalletConnect",
    icon: "🔗",
    guide: "Scan the WalletConnect QR code with any compatible Stellar wallet.",
  },
];

const WALLET_STORAGE_KEY = "stellar.wallet.provider";


export default function Nav() {
  const [q, setQ] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "light";
    const stored = localStorage.getItem("theme");
    if (stored) return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [wallet, setWallet] = useState<WalletId | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem(WALLET_STORAGE_KEY);
    return stored && WALLETS.some((w) => w.id === stored) ? (stored as WalletId) : null;
  });
  const [walletError, setWalletError] = useState<string | null>(null);
  const nav = useNavigate();
  const { resolvedTheme, toggleTheme } = useTheme();

  // Apply theme on mount and whenever it changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Escape key handler for wallet modal
  useEffect(() => {
    if (!walletModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWalletModalOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [walletModalOpen]);

  // Keep in sync with system preference changes (e.g. user changes OS theme)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      // Only follow system if user hasn't overridden it
      const stored = localStorage.getItem("theme");
      if (!stored) {
        setTheme(e.matches ? "dark" : "light");
      }
    };
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  function toggleTheme() {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }

  function search(e: React.FormEvent) {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    if (v.startsWith("G") && v.length === 56) nav(`/wallet/${v}`);
    else nav(`/contract/${v}`);
    setQ("");
    setMenuOpen(false);
  }

  function connectWallet(id: WalletId) {
    const option = WALLETS.find((w) => w.id === id);
    if (!option) return;
    setWalletError(null);
    try {
      localStorage.setItem(WALLET_STORAGE_KEY, id);
      setWallet(id);
      setWalletModalOpen(false);
    } catch {
      setWalletError(`Unable to connect to ${option.name}. Make sure the wallet is installed and try again.`);
    }
  }

  function disconnectWallet() {
    localStorage.removeItem(WALLET_STORAGE_KEY);
    setWallet(null);
    setWalletError(null);
  }

  const activeWallet = wallet ? WALLETS.find((w) => w.id === wallet) : null;

  const linkStyle = (isActive: boolean) => ({
    fontWeight: 600,
    fontSize: 15,
    whiteSpace: "nowrap" as const,
    color: isActive ? "var(--accent)" : "inherit",
    borderBottom: isActive ? "2px solid var(--accent)" : "none",
    paddingBottom: isActive ? "4px" : "0px",
  });

  return (
