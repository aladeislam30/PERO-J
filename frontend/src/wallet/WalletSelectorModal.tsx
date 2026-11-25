import { useEffect } from "react";
import { useWallet } from "./WalletProvider";
import { wallets } from "./walletKit";

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function WalletIcon({ name }: { name: string }) {
  if (name === "Freighter") {
    return (
      <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
        <circle cx="16" cy="16" r="15" fill="#1f6feb" />
        <path d="M6 16 26 7l-5 9 5 9-20-9Zm5 0 9 4-3-4 3-4-9 4Z" fill="#fff" />
      </svg>
    );
  }
  if (name === "xBull") {
    return (
      <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#f5a623" />
        <path d="M8 8c4 1 6 3 8 6 2-3 4-5 8-6-1 4-3 6-5 7 1 4-1 8-3 9-2-1-4-5-3-9-2-1-4-3-5-7Z" fill="#3d1c00" />
      </svg>
    );
  }
  if (name === "Albedo") {
    return (
      <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
        <rect width="32" height="32" rx="16" fill="#7c3aed" />
        <circle cx="16" cy="16" r="6" fill="#fff" />
        <g stroke="#fff" strokeWidth="2" strokeLinecap="round">
          <path d="M16 3v4M16 25v4M3 16h4M25 16h4M7 7l3 3M22 22l3 3M25 7l-3 3M10 22l-3 3" />
        </g>
      </svg>
    );
  }
  if (name === "LOBSTR") {
    return (
      <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#e11d48" />
        <path d="M9 24c0-8 3-13 7-13s7 5 7 13h-4c0-5-1-8-3-8s-3 3-3 8H9Zm1-14 4-5 2 5h-6Zm12 0-4-5-2 5h6Z" fill="#fff" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#3b99fc" />
      <path
        d="M11 13a7 7 0 0 1 10 0l-2 2a4 4 0 0 0-6 0l-2-2Zm4 4a2 2 0 0 1 2 0l4 4a1.5 1.5 0 0 1-2 2l-3-3-3 3a1.5 1.5 0 0 1-2-2l4-4Z"
        fill="#fff"
      />
    </svg>
  );
}

export function WalletSelectorModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address, providerId, status, error, connectingId, availability, connect, disconnect, clearError } = useWallet();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="wallet-modal-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-modal-title">
        <div className="wallet-modal-header">
          <h2 id="wallet-modal-title">Connect a Stellar wallet</h2>
          <button type="button" className="wallet-modal-close" aria-label="Close wallet selector" onClick={onClose}>
            ×
          </button>
        </div>

        {address && providerId && (
          <div className="wallet-connected">
            <div>
              <strong>{wallets.find(wallet => wallet.id === providerId)?.name}</strong>
              <span className="wallet-address">{shortAddress(address)}</span>
            </div>
            <button type="button" className="wallet-secondary" onClick={() => void disconnect()}>
              Disconnect
            </button>
          </div>
        )}

        {error && (
          <div className="wallet-error" role="alert">
            <span>{error}</span>
            <button type="button" className="wallet-secondary" onClick={clearError}>
              Dismiss
            </button>
          </div>
        )}

        <div className="wallet-list">
          {wallets.map(wallet => {
            const available = availability[wallet.id] ?? false;
            const isConnected = providerId === wallet.id && Boolean(address);
            const isConnecting = connectingId === wallet.id;
            return (
              <button
                key={wallet.id}
                type="button"
                className={`wallet-option${isConnected ? " is-connected" : ""}`}
                disabled={!available || isConnecting || isConnected}
                onClick={() => {
                  void connect(wallet.id).then(connected => {
                    if (connected) onClose();
                  });
                }}
              >
                <WalletIcon name={wallet.name} />
                <span className="wallet-option-copy">
                  <span className="wallet-option-title">
                    <strong>{wallet.name}</strong>
                    <span className={`badge ${available ? "green" : "yellow"}`}>
                      {available ? "Available" : wallet.configured ? "Not installed" : "Setup required"}
                    </span>
                  </span>
                  <span className="wallet-option-guide">{wallet.guide}</span>
                </span>
                <span className="wallet-option-action">
                  {isConnecting ? "Connecting…" : isConnected ? "Connected" : "Connect"}
                </span>
              </button>
            );
          })}
        </div>

        <p className="wallet-modal-note">
          Wallets are never asked for your secret key. Approve connection and signing requests in the wallet itself.
          {status === "connecting" && " Complete the request in your wallet."}
        </p>
      </div>
    </div>
  );
}
