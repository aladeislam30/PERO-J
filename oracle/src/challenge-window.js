/** Seconds a submission stays challengeable; must match the contract (72h). */
export function challengeWindowSeconds(env = process.env) {
  const raw = env.ORACLE_CHALLENGE_WINDOW_SECONDS;
  if (raw === undefined || raw === "") {
    return 72 * 60 * 60;
  }
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new RangeError("ORACLE_CHALLENGE_WINDOW_SECONDS must be a positive integer");
  }
  return seconds;
}
