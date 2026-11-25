export type OracleBondRole = "submitter" | "challenger";

export type OracleBondStatus = "escrowed" | "returned" | "slashed";

export interface OracleBond {
  id: string;
  marketTitle: string;
  role: OracleBondRole;
  amountXlm: number;
  status: OracleBondStatus;
  txHash: string;
  createdAt: string;
  rewardXlm?: number;
}

const STORAGE_PREFIX = "pero-j:oracle-bonds:";
const CHANGE_EVENT = "oracle-bonds-change";

export const ORACLE_BONDS_CHANGE_EVENT = CHANGE_EVENT;

function storageKey(address: string): string {
  return `${STORAGE_PREFIX}${address}`;
}

export function readOracleBonds(address: string): OracleBond[] {
  if (!address || typeof localStorage === "undefined") return [];

  try {
    const raw = localStorage.getItem(storageKey(address));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as OracleBond[])
      .filter(isOracleBond)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch {
    return [];
  }
}

export function writeOracleBonds(address: string, bonds: OracleBond[]): void {
  if (!address || typeof localStorage === "undefined") return;

  try {
    localStorage.setItem(storageKey(address), JSON.stringify(bonds));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(CHANGE_EVENT));
    }
  } catch {
    return;
  }
}

export function upsertOracleBond(address: string, bond: OracleBond): void {
  writeOracleBonds(address, [bond, ...readOracleBonds(address).filter((b) => b.id !== bond.id)]);
}

export function formatXlm(amount: number): string {
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: 7 })} XLM`;
}

export function roleLabel(role: OracleBondRole): string {
  return role === "submitter" ? "Submitter" : "Challenger";
}

export function bondStatusLabel(bond: OracleBond): string {
  if (bond.status === "returned") {
    return bond.rewardXlm && bond.rewardXlm > 0
      ? `Returned with reward (+${formatXlm(bond.rewardXlm)})`
      : "Returned";
  }
  return bond.status === "escrowed" ? "Escrowed" : "Slashed";
}

export function stellarExpertTxUrl(txHash: string): string {
  const network = import.meta.env.VITE_STELLAR_NETWORK === "public" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${network}/tx/${encodeURIComponent(txHash)}`;
}

export function shortenTxHash(txHash: string): string {
  if (txHash.length <= 20) return txHash;
  return `${txHash.slice(0, 8)}…${txHash.slice(-8)}`;
}

function isOracleBond(value: unknown): value is OracleBond {
  if (typeof value !== "object" || value === null) return false;
  const bond = value as Partial<OracleBond>;
  return (
    typeof bond.id === "string" &&
    typeof bond.marketTitle === "string" &&
    (bond.role === "submitter" || bond.role === "challenger") &&
    typeof bond.amountXlm === "number" &&
    (bond.status === "escrowed" || bond.status === "returned" || bond.status === "slashed") &&
    typeof bond.txHash === "string" &&
    typeof bond.createdAt === "string"
  );
}
