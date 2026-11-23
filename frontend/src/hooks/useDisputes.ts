import { useEffect, useState } from "react";
import { DISPUTES_CHANGE_EVENT, readDispute, readDisputes } from "../disputes/storage";
import type { Dispute } from "../disputes/types";

const REFRESH_INTERVAL_MS = 5_000;

export function useDisputes(): Dispute[] {
  const [disputes, setDisputes] = useState<Dispute[]>(() => readDisputes());

  useEffect(() => {
    const refresh = () => setDisputes(readDisputes());
    refresh();

    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    window.addEventListener("storage", refresh);
    window.addEventListener(DISPUTES_CHANGE_EVENT, refresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", refresh);
      window.removeEventListener(DISPUTES_CHANGE_EVENT, refresh);
    };
  }, []);

  return disputes;
}

export function useDispute(marketId: string): Dispute | undefined {
  const disputes = useDisputes();
  const [dispute, setDispute] = useState<Dispute | undefined>(() => readDispute(marketId));

  useEffect(() => {
    setDispute(readDispute(marketId));
  }, [marketId, disputes]);

  return dispute;
}
