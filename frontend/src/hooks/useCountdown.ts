import { useEffect, useState } from "react";

export function useCountdown(deadline: string): number {
  const deadlineMs = Date.parse(deadline);
  const [remaining, setRemaining] = useState(() => Math.max(0, deadlineMs - Date.now()));

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, deadlineMs - Date.now()));
    tick();
    const interval = window.setInterval(tick, 1_000);
    return () => window.clearInterval(interval);
  }, [deadlineMs]);

  return remaining;
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const time = [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  return days > 0 ? `${days}d ${time}` : time;
}
