import { auditEvents } from "../db/schema.js";
import type { AuditEventType } from "@recovery/shared";
import { project, type ProjectionPatch } from "./project.js";

/**
 * The single writer path for the whole recovery domain.
 * Appends an audit event and immediately projects it onto Recovery Case,
 * in the same transaction. This is the only function anywhere in the
 * codebase that is allowed to call project().
 */
export async function appendAudit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  params: {
    recoveryCaseId: string;
    subscriptionId: string;
    paymentId?: string | null;
    eventType: AuditEventType;
    payload: unknown;
  },
  patch: ProjectionPatch = {}
): Promise<void> {
  await tx.insert(auditEvents).values({
    recoveryCaseId: params.recoveryCaseId,
    subscriptionId: params.subscriptionId,
    paymentId: params.paymentId ?? null,
    eventType: params.eventType,
    payload: params.payload as object,
  });

  await project(tx, params.recoveryCaseId, params.eventType, patch);
}
