import { sql } from "drizzle-orm";
import { db, pool } from "../db/client.js";

/** Truncates every domain table between tests. Test DB only — never call against dev/prod. */
export async function resetDb(): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      audit_events, due_actions, outreach, recovery_actions,
      recovery_cases, ingested_events, payments, subscriptions
    RESTART IDENTITY CASCADE
  `);
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
