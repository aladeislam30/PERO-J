/**
 * Automated secret rotation for API keys, database credentials, and hot wallet keys.
 *
 * Usage:
 *   ts-node backend/scripts/rotate-secrets.ts --target=db
 *   ts-node backend/scripts/rotate-secrets.ts --target=api-keys
 *   ts-node backend/scripts/rotate-secrets.ts --target=wallet
 *   ts-node backend/scripts/rotate-secrets.ts --target=all
 *
 * See docs/SECRET-ROTATION.md for the full runbook.
 */
import { randomBytes } from 'crypto';
import { Client } from 'pg';

interface RotationConfig {
  host: string;
  port: number;
  database: string;
  adminUser: string;
  adminPassword: string;
  /** Primary (active) application user. */
  primaryUser: string;
  /** Secondary (standby) application user used for dual-user rotation. */
  secondaryUser: string;
}

interface RotationResult {
  target: string;
  rotated: boolean;
  details: Record<string, string>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadConfig(): RotationConfig {
  return {
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    database: requireEnv('PGDATABASE'),
    adminUser: process.env.PG_ADMIN_USER ?? 'postgres',
    adminPassword: requireEnv('PG_ADMIN_PASSWORD'),
    primaryUser: process.env.PG_PRIMARY_USER ?? 'app_primary',
    secondaryUser: process.env.PG_SECONDARY_USER ?? 'app_secondary',
  };
}

function generatePassword(): string {
  return randomBytes(32).toString('base64url');
}

async function withAdminClient<T>(
  config: RotationConfig,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.adminUser,
    password: config.adminPassword,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Zero-downtime PostgreSQL password rotation using dual-user rotation.
 *
 * The application connects through a role that is currently active. We rotate
 * the *standby* user's password first, verify it works, then flip the active
 * user. Because both users share the same privileges, the app can keep serving
 * traffic on the old user while the new credentials are rolled out.
 */
async function rotateDatabase(config: RotationConfig): Promise<RotationResult> {
  const activeUser = process.env.PG_ACTIVE_USER ?? config.primaryUser;
  const standbyUser =
    activeUser === config.primaryUser ? config.secondaryUser : config.primaryUser;
  const newPassword = generatePassword();

  await withAdminClient(config, async (client) => {
    // Rotate the standby user first so the active connection pool is untouched.
    await client.query(`ALTER ROLE ${quoteIdent(standbyUser)} WITH PASSWORD $1`, [
      newPassword,
    ]);
  });

  // Verify the new credentials before flipping the active user.
  const verify = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: standbyUser,
    password: newPassword,
  });
  await verify.connect();
  await verify.query('SELECT 1');
  await verify.end();

  return {
    target: 'db',
    rotated: true,
    details: {
      standbyUser,
      activeUser,
      // Emit the new password so the operator can update the secret store.
      newPassword,
      nextStep: `Update secret store for ${standbyUser}, then set PG_ACTIVE_USER=${standbyUser}`,
    },
  };
}

function quoteIdent(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

/**
 * Rotates API keys. New keys are generated and printed for the operator to
 * persist into the secret manager; the previous key remains valid until the
 * consumer is redeployed (handled by the runbook).
 */
async function rotateApiKeys(): Promise<RotationResult> {
  const keys = ['API_KEY', 'JWT_SECRET', 'WEBHOOK_SIGNING_SECRET'];
  const details: Record<string, string> = {};
  for (const key of keys) {
    details[key] = randomBytes(32).toString('hex');
  }
  return { target: 'api-keys', rotated: true, details };
}

/**
 * Rotates hot wallet keys. The new key material is generated and emitted for
 * secure storage; the old key must be drained/retired per the runbook.
 */
async function rotateWallet(): Promise<RotationResult> {
  const privateKey = randomBytes(32).toString('hex');
  return {
    target: 'wallet',
    rotated: true,
    details: {
      HOT_WALLET_PRIVATE_KEY: privateKey,
      nextStep: 'Store key in KMS/secret manager and retire the previous key',
    },
  };
}

async function main(): Promise<void> {
  const targetArg = process.argv.find((arg) => arg.startsWith('--target='));
  const target = targetArg ? targetArg.split('=')[1] : 'all';

  const results: RotationResult[] = [];

  if (target === 'db' || target === 'all') {
    results.push(await rotateDatabase(loadConfig()));
  }
  if (target === 'api-keys' || target === 'all') {
    results.push(await rotateApiKeys());
  }
  if (target === 'wallet' || target === 'all') {
    results.push(await rotateWallet());
  }

  if (results.length === 0) {
    throw new Error(`Unknown rotation target: ${target}`);
  }

  // Emit results as JSON so CI/operators can pipe into the secret manager.
  process.stdout.write(JSON.stringify({ results }, null, 2) + '\n');
}

main().catch((error) => {
  process.stderr.write(`Secret rotation failed: ${(error as Error).message}\n`);
  process.exit(1);
});
