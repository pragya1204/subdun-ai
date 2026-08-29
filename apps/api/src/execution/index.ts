import { eq } from "drizzle-orm";
import { recoveryActions, recoveryCases, subscriptions } from "../db/schema.js";
import { provider } from "../providerPort.js";
import { send, type InteractionKind } from "../interaction/index.js";
import { logger } from "../log.js";

const log = logger("execution");

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
      log(`retryPayment case=${caseId} sub=${kase.subscriptionId} amount=${subscription.amount}`);
      const result = await provider.retryPayment({
        subscriptionId: kase.subscriptionId,
        amount: subscription.amount,
        paymentMethodId: subscription.paymentMethodId,
      });
      log(`retryPayment result`, { success: result.success, payment_id: result.paymentId });
      await tx
        .update(recoveryActions)
        .set({ status: "executed", executedAt: new Date(), paymentId: result.paymentId })
        .where(eq(recoveryActions.id, actionId));
      return { success: result.success, paymentId: result.paymentId };
    } catch (e) {
      // Infra failure: does not consume retry budget, does not mark executed.
      log.error("retryPayment threw (infra failure, budget not consumed)", e instanceof Error ? e.message : e);
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
  } catch (e) {
    log.error(`send(${operation}) threw`, e instanceof Error ? e.message : e);
    return { success: false, failed: true };
  }
}
