import { eq, and, ne, desc, asc } from "drizzle-orm";
import {
  recoveryCases,
  payments,
  subscriptions,
  auditEvents,
  recoveryActions,
} from "../db/schema.js";
import {
  RECOVERY_DEADLINE_DAYS,
  RETRY_BUDGET,
  OUTREACH_BUDGET,
  normalizeCategory,
  type AgentContext,
  type Category,
} from "@recovery/shared";
import { allowedPrimitives, allowedTimingStrategies } from "../policy/categoryConfig.js";

/**
 * Builds the full AgentContext fresh for one evaluation.
 * Never cached across evaluations — read-only, no side effects.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function assembleContext(caseId: string, tx: any): Promise<AgentContext> {
  const kase = await tx.query.recoveryCases.findFirst({ where: eq(recoveryCases.id, caseId) });
  if (!kase) throw new Error(`Recovery case ${caseId} not found`);

  const originatingPayment = await tx.query.payments.findFirst({
    where: eq(payments.id, kase.paymentId),
  });

  const subscription = await tx.query.subscriptions.findFirst({
    where: eq(subscriptions.id, kase.subscriptionId),
  });

  const latestFailureEvent = await tx.query.auditEvents.findFirst({
    where: and(eq(auditEvents.recoveryCaseId, caseId)),
    orderBy: [desc(auditEvents.createdAt)],
  });

  const allPayments = await tx
    .select()
    .from(payments)
    .where(eq(payments.subscriptionId, kase.subscriptionId))
    .orderBy(asc(payments.createdAt));

  const successfulPayments = allPayments.filter((p: typeof payments.$inferSelect) => p.status === "success").length;
  const failedPayments = allPayments.filter((p: typeof payments.$inferSelect) => p.status === "failed").length;
  const previousFailures = allPayments
    .filter((p: typeof payments.$inferSelect) => p.status === "failed" && p.id !== kase.paymentId)
    .map((p: typeof payments.$inferSelect) => ({
      category: normalizeCategory(p.errorCode) as Category,
      created_at: p.createdAt.toISOString(),
    }));

  const priorActionRows = await tx
    .select()
    .from(recoveryActions)
    .where(eq(recoveryActions.recoveryCaseId, caseId))
    .orderBy(asc(recoveryActions.createdAt));
  const prior_actions = priorActionRows.map((a: typeof recoveryActions.$inferSelect) => ({
    operation: a.operation as AgentContext["recovery_history"]["prior_actions"][number]["operation"],
    timing_strategy: a.timingStrategy as AgentContext["recovery_history"]["prior_actions"][number]["timing_strategy"],
    reason: a.reason,
    created_at: a.createdAt.toISOString(),
  }));

  const signalEvents = await tx
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.recoveryCaseId, caseId), eq(auditEvents.eventType, "CUSTOMER_SIGNAL")))
    .orderBy(desc(auditEvents.createdAt));

  let paymentMethodUpdated: boolean | null = null;
  let customerActionCompleted: boolean | null = null;
  for (const evt of signalEvents) {
    const payload = evt.payload as Record<string, unknown>;
    if (paymentMethodUpdated === null && typeof payload.payment_method_updated === "boolean") {
      paymentMethodUpdated = payload.payment_method_updated;
    }
    if (customerActionCompleted === null && typeof payload.customer_action_completed === "boolean") {
      customerActionCompleted = payload.customer_action_completed;
    }
  }

  const now = new Date();
  const category = kase.category as Category;

  let primitives = allowedPrimitives(category);
  if (kase.retriesUsed >= RETRY_BUDGET) primitives = primitives.filter((p) => p !== "RETRY_PAYMENT");
  if (kase.outreachUsed >= OUTREACH_BUDGET) {
    primitives = primitives.filter(
      (p) => !["OUTREACH", "REQUEST_PAYMENT_METHOD_UPDATE", "REQUEST_CUSTOMER_ACTION"].includes(p)
    );
  }
  if (kase.optedOut) {
    primitives = primitives.filter(
      (p) => !["OUTREACH", "REQUEST_PAYMENT_METHOD_UPDATE", "REQUEST_CUSTOMER_ACTION"].includes(p)
    );
  }
  if (category === "PAYMENT_METHOD_INVALID" && paymentMethodUpdated !== true) {
    primitives = primitives.filter((p) => p !== "RETRY_PAYMENT");
  }
  if (category === "CUSTOMER_ACTION" && customerActionCompleted !== true) {
    primitives = primitives.filter((p) => p !== "RETRY_PAYMENT");
  }

  const deadline = new Date(kase.startedAt);
  deadline.setDate(deadline.getDate() + RECOVERY_DEADLINE_DAYS);

  const failurePayload = (latestFailureEvent?.payload ?? {}) as Record<string, unknown>;

  return {
    current_failure: {
      category,
      error_code: (failurePayload.error_code as string) ?? originatingPayment?.errorCode ?? "unknown",
      amount: originatingPayment?.amount ?? 0,
      failed_at: (originatingPayment?.createdAt ?? kase.startedAt).toISOString(),
    },
    recovery_history: {
      retries_used: kase.retriesUsed,
      outreach_used: kase.outreachUsed,
      prior_actions,
    },
    subscription_history: {
      successful_payments: successfulPayments,
      failed_payments: failedPayments,
      previous_failures: previousFailures,
    },
    recovery_state: {
      status: kase.status as AgentContext["recovery_state"]["status"],
      days_since_failure: (now.getTime() - kase.startedAt.getTime()) / 86_400_000,
      deadline: kase.deadline.toISOString(),
    },
    customer_signals: {
      opted_out: kase.optedOut,
      complaint: kase.complaint,
      payment_method_updated: paymentMethodUpdated,
      customer_action_completed: customerActionCompleted,
    },
    timing_context: {
      now: now.toISOString(),
      next_billing_date: subscription?.nextBillingDate ?? null,
      days_remaining: (kase.deadline.getTime() - now.getTime()) / 86_400_000,
    },
    allowed_primitives: primitives,
    allowed_timing_strategies: allowedTimingStrategies(category),
  };
}
