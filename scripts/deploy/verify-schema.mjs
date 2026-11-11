#!/usr/bin/env node
/**
 * After `db:migrate` on a production deploy, prove the live chain reached the migrations the
 * running code expects. A green migrator with a stale database (or DDL through the wrong pool)
 * used to ship code that 500s on the first query against a new column — sign-in broke on
 * `guests.alternate_names` exactly that way.
 */
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';

/** Columns introduced after 0017 that guest sign-in and social auth depend on. */
const REQUIRED = [
  { table: 'guests', column: 'alternate_names' },
  { table: 'guests', column: 'phone' },
  { table: 'invitations', column: 'sent_at' },
  { table: 'auth_users', column: 'phone_number' },
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('verify-schema: DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

try {
  const missing = [];
  for (const r of REQUIRED) {
    const rows = await sql`
      select 1 as ok
      from information_schema.columns
      where table_schema = 'public'
        and table_name = ${r.table}
        and column_name = ${r.column}
      limit 1
    `;
    if (!rows.length) missing.push(r);
  }
  if (missing.length) {
    console.error('verify-schema: database is behind the migration chain:');
    for (const m of missing) console.error(`  missing ${m.table}.${m.column}`);
    process.exit(1);
  }
  console.log(`verify-schema: ok (${REQUIRED.length} required columns present)`);
} catch (e) {
  console.error('verify-schema failed:');
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
