import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { recoveryCases } from "../db/schema.js";

export type RecoveryCaseRow = typeof recoveryCases.$inferSelect;

/**
 * Opens one transaction, acquires a row-level lock on the case for the
 * duration of the callback (Phase 2 §7 per-case serialization), and commits.
 * If the case doesn't exist or `fn` throws, the transaction rolls back.
 */
export async function withCaseLock<T>(
  caseId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], kase: RecoveryCaseRow) => Promise<T>
): Promise<T | undefined> {
  return db.transaction(async (tx) => {
    const result = await tx.execute(
      sql`SELECT * FROM recovery_cases WHERE id = ${caseId} FOR UPDATE`
    );
    const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
    const raw = rows[0];
    if (!raw) return undefined;
    const kase = mapRow(raw as Record<string, unknown>);
    return fn(tx, kase);
  });
}

function mapRow(row: Record<string, unknown>): RecoveryCaseRow {
  return {
    id: row.id as string,
    subscriptionId: row.subscription_id as string,
    paymentId: row.payment_id as string,
    category: row.category as string,
    status: row.status as string,
    retriesUsed: row.retries_used as number,
    outreachUsed: row.outreach_used as number,
    optedOut: row.opted_out as boolean,
    complaint: row.complaint as boolean,
    startedAt: new Date(row.started_at as string),
    deadline: new Date(row.deadline as string),
    version: row.version as number,
    updatedAt: new Date(row.updated_at as string),
  };
}
