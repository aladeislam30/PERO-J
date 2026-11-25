import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;

test(
  "database migrations roll back on failure and apply idempotently",
  { skip: !databaseUrl && "DATABASE_URL is required for PostgreSQL migration tests" },
  async () => {
    const schema = `test_db_migrations_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Client({ connectionString: databaseUrl });
    let db;

    await admin.connect();
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await admin.query(`CREATE VIEW "${schema}".events AS SELECT 1 AS incompatible`);

      const scopedUrl = new URL(databaseUrl);
      scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
      process.env.DATABASE_URL = scopedUrl.toString();

      ({ db } = await import("../src/db.js"));

      await assert.rejects(db.init(), (error) => error.code === "42809");
      const afterRollback = await admin.query("SELECT to_regclass($1) AS migrations_table", [
        `${schema}.schema_migrations`,
      ]);
      assert.equal(afterRollback.rows[0].migrations_table, null);

      await admin.query(`DROP VIEW "${schema}".events`);
      await db.init();
      // Replaying the SQL itself verifies its IF NOT EXISTS guards.
      await admin.query(`TRUNCATE TABLE "${schema}".schema_migrations`);
      await db.init();

      const tables = await admin.query(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
        [schema]
      );
      assert.deepEqual(
        new Set(tables.rows.map(({ table_name }) => table_name)),
        new Set(["schema_migrations", "events", "indexer_state", "contracts"])
      );

      const migrations = await admin.query(
        `SELECT id FROM "${schema}".schema_migrations ORDER BY id`
      );
      assert.deepEqual(
        migrations.rows.map(({ id }) => id),
        [1, 2, 3, 4, 5]
      );

      const indexes = await admin.query(
        `SELECT indexname
         FROM pg_indexes
         WHERE schemaname = $1`,
        [schema]
      );
      const indexNames = new Set(indexes.rows.map(({ indexname }) => indexname));
      for (const indexName of [
        "idx_events_contract",
        "idx_events_function",
        "idx_events_ledger",
        "idx_events_addresses",
        "idx_events_description_tsv",
      ]) {
        assert.ok(indexNames.has(indexName), `missing index ${indexName}`);
      }

      const constraints = await admin.query(
        `SELECT table_name, constraint_type
         FROM information_schema.table_constraints
         WHERE table_schema = $1 AND constraint_type = 'PRIMARY KEY'`,
        [schema]
      );
      assert.deepEqual(
        new Set(constraints.rows.map(({ table_name }) => table_name)),
        new Set(["schema_migrations", "events", "indexer_state", "contracts"])
      );
    } finally {
      try {
        if (db) {
          await db.close();
        }
      } finally {
        try {
          await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally {
          await admin.end();
        }
      }
    }
  }
);
