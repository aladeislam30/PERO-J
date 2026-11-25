import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { KitEventType } from "@creit.tech/stellar-wallets-kit/types";
import { describeWalletError, findWallet, networkPassphrase, wallets } from "./walletKit";

const STORAGE_KEY = "ipredict.wallet.provider";
let autoConnectAttempted = false;

type WalletStatus = "disconnected" | "connecting" | "connected" | "error";

interface WalletContextValue {
  address: string | null;
  providerId: string | null;
  providerName: string | null;
  status: WalletStatus;
  error: string | null;
  connectingId: string | null;
  availability: Record<string, boolean>;
  connect: (id: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
  signTransaction: (xdr: string) => Promise<string>;
  clearError: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;
    Promise.all(
      wallets.map(async wallet => {
        const available = wallet.configured && wallet.module ? await wallet.module.isAvailable().catch(() => false) : false;
        return [wallet.id, available] as const;
      }),
    ).then(entries => {
      if (active) setAvailability(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const dispose = StellarWalletsKit.on(KitEventType.STATE_UPDATED, event => {
      if (event.payload.address) setAddress(event.payload.address);
    });
    return dispose;
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved || !findWallet(saved)?.configured || autoConnectAttempted) return;
    autoConnectAttempted = true;
    let cancelled = false;

    void (async () => {
      try {
        StellarWalletsKit.setWallet(saved);
        const result = await StellarWalletsKit.fetchAddress();
        if (cancelled) return;
        setAddress(result.address);
        setProviderId(saved);
        setStatus("connected");
      } catch (cause) {
        if (cancelled) return;
        setError(`Could not reconnect to ${findWallet(saved)?.name ?? "your wallet"}. ${describeWalletError(cause)}`);
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const connect = useCallback(async (id: string) => {
    const wallet = findWallet(id);
    setError(null);
    setConnectingId(id);
    setStatus("connecting");

    try {
      if (!wallet?.configured || !wallet.module) {
        throw new Error(`${wallet?.name ?? "This wallet"} is not configured for this deployment.`);
      }
      const available = await wallet.module.isAvailable().catch(() => false);
      if (!available) {
        throw new Error(`${wallet.name} is not installed or available. Install it from ${wallet.url} and try again.`);
      }
      StellarWalletsKit.setWallet(id);
      const result = await StellarWalletsKit.fetchAddress();
      setAddress(result.address);
      setProviderId(id);
      setStatus("connected");
      localStorage.setItem(STORAGE_KEY, id);
      return true;
    } catch (cause) {
      setError(describeWalletError(cause));
      setStatus("error");
      return false;
    } finally {
      setConnectingId(null);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await StellarWalletsKit.disconnect();
    } catch {
      setStatus("disconnected");
    }
    localStorage.removeItem(STORAGE_KEY);
    setAddress(null);
    setProviderId(null);
    setStatus("disconnected");
    setError(null);
  }, []);

  const signTransaction = useCallback(
    async (xdr: string) => {
      if (!address) throw new Error("Connect a wallet before signing a transaction.");
      try {
        const result = await StellarWalletsKit.signTransaction(xdr, {
          address,
          networkPassphrase,
        });
        return result.signedTxXdr;
      } catch (cause) {
        setError(describeWalletError(cause));
        throw cause;
      }
    },
    [address],
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      address,
      providerId,
      providerName: findWallet(providerId)?.name ?? null,
      status,
      error,
      connectingId,
      availability,
      connect,
      disconnect,
      signTransaction,
      clearError,
    }),
    [address, providerId, status, error, connectingId, availability, connect, disconnect, signTransaction, clearError],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside WalletProvider");
  return context;
}
