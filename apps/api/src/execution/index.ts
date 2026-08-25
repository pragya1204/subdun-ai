import { eq } from "drizzle-orm";
import { recoveryActions, recoveryCases, subscriptions } from "../db/schema.js";
import { simulatorAdapter } from "../simulator/index.js";
import { send, type InteractionKind } from "../interaction/index.js";

export interface ExecutionResult {
  success: boolean;
  paymentId?: string;
  outreachId?: string;
  failed?: boolean;
}

/**
 * Dispatches an approved RETRY_PAYMENT or OUTREACH-like primitive.
 * Idempotent per action.id — checks recovery_actions.status before executing.
 */
export async function execute(
  caseId: string,
  actionId: string,
  operation: "RETRY_PAYMENT" | InteractionKind,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any
): Promise<ExecutionResult> {
  const existing = await tx.query.recoveryActions.findFirst({ where: eq(recoveryActions.id, actionId) });
  if (existing?.status === "executed") {
    return { success: !!existing.paymentId || operation !== "RETRY_PAYMENT", paymentId: existing.paymentId ?? undefined };
  }

  if (operation === "RETRY_PAYMENT") {
    const kase = await tx.query.recoveryCases.findFirst({ where: eq(recoveryCases.id, caseId) });
    const subscription = await tx.query.subscriptions.findFirst({
      where: eq(subscriptions.id, kase.subscriptionId),
    });

    try {
      const result = await simulatorAdapter.retryPayment({
        subscriptionId: kase.subscriptionId,
        amount: subscription.amount,
        paymentMethodId: subscription.paymentMethodId,
      });
      await tx
        .update(recoveryActions)
        .set({ status: "executed", executedAt: new Date(), paymentId: result.paymentId })
        .where(eq(recoveryActions.id, actionId));
      return { success: result.success, paymentId: result.paymentId };
    } catch {
      // Infra failure: does not consume retry budget, does not mark executed.
      return { success: false, failed: true };
    }
  }

  // OUTREACH-like
  try {
    const record = await send(caseId, operation, tx);
    await tx
      .update(recoveryActions)
      .set({ status: "executed", executedAt: new Date() })
      .where(eq(recoveryActions.id, actionId));
    return { success: true, outreachId: record.id };
  } catch {
    return { success: false, failed: true };
  }
}
