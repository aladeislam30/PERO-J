import { useEffect, useState } from "react";
import { ORACLE_BONDS_CHANGE_EVENT, readOracleBonds, type OracleBond } from "../oracleBonds";

const REFRESH_INTERVAL_MS = 15_000;

export function useOracleBonds(address: string): OracleBond[] {
  const [bonds, setBonds] = useState<OracleBond[]>(() => readOracleBonds(address));

  useEffect(() => {
    const refresh = () => setBonds(readOracleBonds(address));
    refresh();

    if (!address) return;

    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    window.addEventListener("storage", refresh);
    window.addEventListener(ORACLE_BONDS_CHANGE_EVENT, refresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", refresh);
      window.removeEventListener(ORACLE_BONDS_CHANGE_EVENT, refresh);
    };
  }, [address]);

  return bonds;
}
