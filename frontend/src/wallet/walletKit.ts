import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { Networks } from "@creit.tech/stellar-wallets-kit/types";
import type { ModuleInterface } from "@creit.tech/stellar-wallets-kit/types";
import { AlbedoModule, ALBEDO_ID } from "@creit.tech/stellar-wallets-kit/modules/albedo";
import { FreighterModule, FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { LobstrModule, LOBSTR_ID } from "@creit.tech/stellar-wallets-kit/modules/lobstr";
import { xBullModule, XBULL_ID } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import {
  WalletConnectModule,
  WalletConnectTargetChain,
  WALLET_CONNECT_ID,
} from "@creit.tech/stellar-wallets-kit/modules/wallet-connect";

export interface WalletDefinition {
  id: string;
  name: string;
  guide: string;
  url: string;
  module?: ModuleInterface;
  configured: boolean;
}

const network = import.meta.env.VITE_STELLAR_NETWORK === "public" ? Networks.PUBLIC : Networks.TESTNET;
const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "";

const walletConnectModule = walletConnectProjectId
  ? new WalletConnectModule({
      projectId: walletConnectProjectId,
      metadata: {
        name: "PERO-J Explorer",
        description: "Stellar block explorer and prediction markets",
        url: typeof window === "undefined" ? "http://localhost" : window.location.origin,
        icons: ["https://stellar.org/favicon.ico"],
      },
      allowedChains: [network === Networks.PUBLIC
        ? WalletConnectTargetChain.PUBLIC
        : WalletConnectTargetChain.TESTNET],
    })
  : undefined;

const modules: ModuleInterface[] = [
  new FreighterModule(),
  new xBullModule(),
  new AlbedoModule(),
  new LobstrModule(),
  ...(walletConnectModule ? [walletConnectModule] : []),
];

StellarWalletsKit.init({ modules, network });

export const networkPassphrase: string = network;

export const wallets: WalletDefinition[] = [
  {
    id: FREIGHTER_ID,
    name: "Freighter",
    guide: "Install the Freighter extension, create or import an account, then approve this site.",
    url: "https://www.freighter.app/",
    module: modules[0],
    configured: true,
  },
  {
    id: XBULL_ID,
    name: "xBull",
    guide: "Install the xBull extension or open xBull on mobile, then approve the connection.",
    url: "https://xbull.app/",
    module: modules[1],
    configured: true,
  },
  {
    id: ALBEDO_ID,
    name: "Albedo",
    guide: "No extension needed. Albedo opens in a new window to approve access.",
    url: "https://albedo.link/",
    module: modules[2],
    configured: true,
  },
  {
    id: LOBSTR_ID,
    name: "LOBSTR",
    guide: "Install the LOBSTR extension or use the LOBSTR mobile browser, then approve access.",
    url: "https://lobstr.co/",
    module: modules[3],
    configured: true,
  },
  {
    id: WALLET_CONNECT_ID,
    name: "WalletConnect",
    guide: walletConnectModule
      ? "Scan the QR code with a WalletConnect-compatible mobile wallet."
      : "Set VITE_WALLETCONNECT_PROJECT_ID to enable WalletConnect connections.",
    url: "https://walletconnect.com/",
    module: walletConnectModule,
    configured: Boolean(walletConnectModule),
  },
];

export function findWallet(id: string | null): WalletDefinition | undefined {
  return id ? wallets.find(wallet => wallet.id === id) : undefined;
}

export function describeWalletError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "The wallet could not complete the request. Please try again.";
}
