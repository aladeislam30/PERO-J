import { Address, Asset, Networks } from "@stellar/stellar-sdk";
import {
  resolveIncident,
  triggerIncident,
  type FetchImpl,
} from "../lib/pagerduty.ts";
import { simulateRead } from "../lib/soroban.ts";

const BREAKER_NAME = "bond_escrow";
const DEDUP_KEY = "peroj-oracle-bond-escrow-invariant";
const DEFAULT_INTERVAL_MS = 30_000;
/** A pass older than this many intervals no longer permits resolution. */
const MAX_MISSED_INTERVALS = 3;
const SNAPSHOT_ATTEMPTS = 3;

export interface Queryable {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface BondAuditConfig {
  escrowContractId: string;
  routingKey: string | null;
  intervalMs: number;
}

export interface BondAccounting {
  deposited: string;
  settled: string;
  active_disputes: number;
  /** Bonds whose own record is inconsistent. */
  invalid_bonds: { id: string; dispute_id: string }[];
}

export interface AuditResult {
  valid: boolean;
  reason: string | null;
  details: {
    total_bonds_deposited: string;
    total_bonds_settled: string;
    expected_escrow_holdings: string | null;
    current_escrow_holdings: string;
    discrepancy: string | null;
    active_disputes: number;
    invalid_bonds: { id: string; dispute_id: string }[];
  };
}

/** Read the configuration, or null when no escrow contract is configured. */
export function getBondAuditConfig(
  env: NodeJS.ProcessEnv = process.env,
): BondAuditConfig | null {
  const escrowContractId = env.BOND_ESCROW_CONTRACT_ID?.trim();
  if (!escrowContractId) {
    return null;
  }
  const intervalMs = Number(env.BOND_AUDIT_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  if (!Number.isInteger(intervalMs) || intervalMs < 1_000) {
    throw new Error("BOND_AUDIT_INTERVAL_MS must be an integer of at least 1000");
  }
  return {
    escrowContractId,
    routingKey:
      env.PAGERDUTY_OPS_ROUTING_KEY?.trim() ||
      env.PAGERDUTY_ROUTING_KEY?.trim() ||
      null,
    intervalMs,
  };
}

/** Read the escrow contract's native XLM balance, in stroops, from the SAC. */
export async function fetchEscrowBalance(contractId: string): Promise<bigint> {
  const sac = Asset.native().contractId(
    process.env.NETWORK_PASSPHRASE || Networks.TESTNET,
  );
  const balance = await simulateRead(
    sac,
    "balance",
    new Address(contractId).toScVal(),
  );
  if (typeof balance !== "bigint") {
    throw new Error("SAC balance must return an i128");
  }
  return balance;
}

/**
 * Totals and per-bond consistency from one statement, so they share a snapshot.
 * Amounts are whole stroops and are kept as text to avoid float rounding.
 */
const ACCOUNTING_SQL = `
  SELECT
    trim_scale(COALESCE(SUM(amount), 0))::text AS deposited,
    trim_scale(COALESCE(SUM(settled_amount), 0))::text AS settled,
    (COUNT(DISTINCT dispute_id) FILTER (WHERE status = 'deposited'))::int
      AS active_disputes,
    COALESCE(
      json_agg(json_build_object('id', id, 'dispute_id', dispute_id))
        FILTER (WHERE amount <= 0
          OR amount <> trunc(amount)
          OR amount = 'NaN'
          OR settled_amount IS NULL
          OR settled_amount < 0
          OR settled_amount > amount
          OR settled_amount <> trunc(settled_amount)
          OR (status <> 'deposited' AND settled_amount <> amount)),
      '[]'::json
    ) AS invalid_bonds
  FROM dispute_bonds`;

export async function readBondAccounting(
  db: Queryable,
): Promise<BondAccounting> {
  const { rows } = await db.query(ACCOUNTING_SQL);
  return rows[0];
}

/**
 * Assert total_bonds_deposited - total_bonds_settled == current_escrow_holdings
 * and that every individual bond is returned or slashed in full once settled.
 */
export function evaluateInvariant(
  accounting: BondAccounting,
  holdings: bigint,
): AuditResult {
  const base = {
    total_bonds_deposited: accounting.deposited,
    total_bonds_settled: accounting.settled,
    current_escrow_holdings: holdings.toString(),
    active_disputes: accounting.active_disputes,
    invalid_bonds: accounting.invalid_bonds,
  };
  if (accounting.invalid_bonds.length > 0) {
    // The totals may be fractional here, so they are reported but not compared.
    return {
      valid: false,
      reason: `${accounting.invalid_bonds.length} bond record(s) are inconsistent`,
      details: { ...base, expected_escrow_holdings: null, discrepancy: null },
    };
  }

  const expected = BigInt(accounting.deposited) - BigInt(accounting.settled);
  const discrepancy = holdings - expected;
  return {
    valid: discrepancy === 0n,
    reason:
      discrepancy === 0n
        ? null
        : `escrow holds ${holdings} stroops but ${expected} are expected`,
    details: {
      ...base,
      expected_escrow_holdings: expected.toString(),
      discrepancy: discrepancy.toString(),
    },
  };
}

/**
 * Run one audit. The balance is only compared with accounting that did not
 * change while it was being fetched. Throws when a reading is unavailable.
 */
export async function auditBondEscrow(
  db: Queryable,
  fetchBalance: () => Promise<bigint>,
): Promise<AuditResult> {
  let before = await readBondAccounting(db);
  for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt++) {
    const holdings = await fetchBalance();
    const after = await readBondAccounting(db);
    if (
      before.deposited === after.deposited &&
      before.settled === after.settled
    ) {
      return evaluateInvariant(after, holdings);
    }
    before = after;
  }
  throw new Error("bond accounting kept changing during the audit");
}

/**
 * Circuit breaker stored in the database, so a trip survives restarts and is
 * shared by every process. It stays tripped until it is explicitly reset.
 */
export class BondEscrowGuard {
  readonly status = {
    tripped: false,
    reason: null as string | null,
    lastPassAt: null as number | null,
    lastError: null as string | null,
  };
  private readonly db: Queryable;
  private readonly config: BondAuditConfig;
  private readonly fetchBalance: () => Promise<bigint>;
  private readonly fetchImpl: FetchImpl;
  private readonly now: () => number;
  /** A violation that has not been written to the database yet. */
  private unsaved: AuditResult | null = null;

  constructor(
    db: Queryable,
    config: BondAuditConfig,
    deps: {
      fetchBalance?: () => Promise<bigint>;
      fetchImpl?: FetchImpl;
      now?: () => number;
    } = {},
  ) {
    this.db = db;
    this.config = config;
    this.fetchBalance =
      deps.fetchBalance ?? (() => fetchEscrowBalance(config.escrowContractId));
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? Date.now;
  }

  /** Audit once, tripping the breaker and alerting on a violation. */
  async check(): Promise<AuditResult> {
    try {
      const result = await auditBondEscrow(this.db, this.fetchBalance);
      if (result.valid) {
        this.status.lastPassAt = this.now();
      } else {
        this.trip(result);
      }
      this.status.lastError = null;
      return result;
    } catch (err) {
      this.status.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      // Also retries a save or alert that failed on an earlier check.
      await this.saveAndAlert();
    }
  }

  /**
   * Whether automated resolution may proceed. Fails closed: requires a recent
   * passing audit and a breaker that can be read and is not tripped.
   */
  async isResolutionAllowed(): Promise<boolean> {
    if (this.unsaved || this.status.lastPassAt === null) {
      return false;
    }
    const maxAge = this.config.intervalMs * MAX_MISSED_INTERVALS;
    if (this.now() - this.status.lastPassAt > maxAge) {
      return false;
    }
    try {
      const { rows } = await this.db.query(
        "SELECT tripped, reason FROM circuit_breakers WHERE name = $1",
        [BREAKER_NAME],
      );
      this.status.tripped = rows[0]?.tripped ?? false;
      this.status.reason = this.status.tripped ? rows[0].reason : null;
      return !this.status.tripped;
    } catch (err) {
      console.error("[bond-audit] circuit breaker unreadable:", err);
      return false;
    }
  }

  /** Re-enable resolution, but only if the invariant holds again. */
  async reset(): Promise<AuditResult> {
    const result = await this.check();
    if (result.valid) {
      await this.db.query(
        "UPDATE circuit_breakers SET tripped = FALSE, updated_at = NOW() WHERE name = $1",
        [BREAKER_NAME],
      );
      this.status.tripped = false;
      this.status.reason = null;
      if (this.config.routingKey) {
        await resolveIncident(this.config.routingKey, DEDUP_KEY, this.fetchImpl);
      }
    }
    return result;
  }

  private trip(result: AuditResult): void {
    this.unsaved = result;
    this.status.tripped = true;
    this.status.reason = result.reason;
    this.status.lastPassAt = null;
    console.error(
      JSON.stringify({
        level: "critical",
        event: "bond_escrow_invariant_violation",
        reason: result.reason,
        ...result.details,
      }),
    );
  }

  private async saveAndAlert(): Promise<void> {
    try {
      if (this.unsaved) {
        // Keeps the first violation's reason while already tripped.
        await this.db.query(
          `INSERT INTO circuit_breakers (name, tripped, reason, details, alerted)
           VALUES ($1, TRUE, $2, $3, FALSE)
           ON CONFLICT (name) DO UPDATE SET
             tripped = TRUE, reason = EXCLUDED.reason,
             details = EXCLUDED.details, alerted = FALSE, updated_at = NOW()
           WHERE NOT circuit_breakers.tripped`,
          [
            BREAKER_NAME,
            this.unsaved.reason,
            JSON.stringify(this.unsaved.details),
          ],
        );
        this.unsaved = null;
      }
    } catch (err) {
      console.error("[bond-audit] failed to save the circuit breaker:", err);
      if (this.unsaved) {
        // Never let a database outage suppress the page.
        await this.alert(this.unsaved.reason, this.unsaved.details);
      }
      return;
    }

    try {
      const { rows } = await this.db.query(
        "SELECT reason, details FROM circuit_breakers WHERE name = $1 AND tripped AND NOT alerted",
        [BREAKER_NAME],
      );
      if (rows[0] && (await this.alert(rows[0].reason, rows[0].details))) {
        await this.db.query(
          "UPDATE circuit_breakers SET alerted = TRUE, updated_at = NOW() WHERE name = $1",
          [BREAKER_NAME],
        );
      }
    } catch (err) {
      console.error("[bond-audit] failed to read pending alerts:", err);
    }
  }

  private async alert(
    reason: string | null,
    details: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.config.routingKey) {
      return false;
    }
    try {
      await triggerIncident(
        this.config.routingKey,
        {
          dedupKey: DEDUP_KEY,
          summary: `Bond escrow invariant violated, automated resolution halted: ${reason}`,
          severity: "critical",
          source: "PERO-J Oracle bond escrow audit",
          component: "oracle",
          group: "escrow",
          class: "bond-escrow-invariant",
          details: {
            ...details,
            // Bounded so a widespread failure still fits PagerDuty's limit.
            invalid_bonds: Array.isArray(details.invalid_bonds)
              ? details.invalid_bonds.slice(0, 20)
              : [],
          },
        },
        this.fetchImpl,
      );
      return true;
    } catch (err) {
      console.error("[bond-audit] alert failed, will retry:", err);
      return false;
    }
  }
}

/** Audit now and then continuously. Returns a function that stops auditing. */
export function startBondEscrowAudit(
  guard: Pick<BondEscrowGuard, "check">,
  intervalMs: number,
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const loop = async () => {
    try {
      await guard.check();
    } catch (err) {
      console.error("[bond-audit] audit could not complete:", err);
    }
    if (!stopped) {
      timer = setTimeout(loop, intervalMs);
    }
  };

  void loop();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
