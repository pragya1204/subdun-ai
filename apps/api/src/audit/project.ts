import { eq, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { recoveryCases } from "../db/schema.js";
import type { AuditEventType, CaseStatus } from "@recovery/shared";

export interface ProjectionPatch {
  status?: CaseStatus;
  retriesUsed?: number;
  outreachUsed?: number;
  optedOut?: boolean;
  complaint?: boolean;
}

/**
 * Folds the just-appended audit event onto the Recovery Case row.
 * Called only from audit.append(), inside the same transaction as the insert.
 * Not an independently-triggered component (Phase 2 §2 note).
 */
export async function project(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  caseId: string,
  _eventType: AuditEventType,
  patch: ProjectionPatch
): Promise<void> {
  if (Object.keys(patch).length === 0) return;

  const setClause: Record<string, unknown> = {
    version: sql`${recoveryCases.version} + 1`,
    updatedAt: new Date(),
  };
  if (patch.status !== undefined) setClause.status = patch.status;
  if (patch.retriesUsed !== undefined) setClause.retriesUsed = patch.retriesUsed;
  if (patch.outreachUsed !== undefined) setClause.outreachUsed = patch.outreachUsed;
  if (patch.optedOut !== undefined) setClause.optedOut = patch.optedOut;
  if (patch.complaint !== undefined) setClause.complaint = patch.complaint;

  await tx.update(recoveryCases).set(setClause).where(eq(recoveryCases.id, caseId));
}
