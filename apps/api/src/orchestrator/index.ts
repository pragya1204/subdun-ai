import { randomUUID } from "node:crypto";
import { eq, and, lte, notInArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  recoveryCases,
  recoveryActions,
  dueActions,
  subscriptions,
} from "../db/schema.js";
import { appendAudit } from "../audit/index.js";
import { assembleContext } from "../context/index.js";
import { proposeNextOperation, fallbackProposal } from "../agent/index.js";
import { validate } from "../policy/index.js";
import { execute } from "../execution/index.js";
import { withCaseLock } from "./lock.js";
import { computeDueAt, nextCommunicationWindow } from "./timing.js";
import {
  isTerminal,
  RECOVERY_DEADLINE_DAYS,
  TERMINAL_STATUSES,
  type AgentProposal,
  type Category,
} from "@recovery/shared";

const OUTREACH_LIKE = new Set(["OUTREACH", "REQUEST_PAYMENT_METHOD_UPDATE", "REQUEST_CUSTOMER_ACTION"]);

/** Creates a brand-new Recovery Case for a subscription's first open failure. */
export async function createCase(params: {
  subscriptionId: string;
  paymentId: string;
  category: Category;
  errorFields: Record<string, unknown>;
}): Promise<string> {
  const caseId = randomUUID();
  const startedAt = new Date();
  const deadline = new Date(startedAt);
  deadline.setDate(deadline.getDate() + RECOVERY_DEADLINE_DAYS);

  await db.transaction(async (tx) => {
    await tx.insert(recoveryCases).values({
      id: caseId,
      subscriptionId: params.subscriptionId,
      paymentId: params.paymentId,
      category: params.category,
      status: "FAILED",
      startedAt,
      deadline,
    });
    await appendAudit(
      tx,
      {
        recoveryCaseId: caseId,
        subscriptionId: params.subscriptionId,
        paymentId: params.paymentId,
        eventType: "FAILURE_RECEIVED",
        payload: { category: params.category, ...params.errorFields },
      },
      { status: "EVALUATING" }
    );
  });

  return caseId;
}

/** A second failure lands on an already-open case: audit-only, shared budget/deadline. */
export async function appendFailureToCase(params: {
  caseId: string;
  subscriptionId: string;
  paymentId: string;
  errorFields: Record<string, unknown>;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await appendAudit(tx, {
      recoveryCaseId: params.caseId,
      subscriptionId: params.subscriptionId,
      paymentId: params.paymentId,
      eventType: "FAILURE_APPENDED",
      payload: params.errorFields,
    });
  });
}

export async function findOpenCaseForSubscription(subscriptionId: string): Promise<string | undefined> {
  const rows = await db
    .select({ id: recoveryCases.id })
    .from(recoveryCases)
    .where(
      and(
        eq(recoveryCases.subscriptionId, subscriptionId),
        notInArray(recoveryCases.status, [...TERMINAL_STATUSES])
      )
    )
    .limit(1);
  return rows[0]?.id;
}

/** One full evaluation cycle: lock -> context -> Agent -> Policy -> execute -> audit -> project. */
export async function evaluate(caseId: string): Promise<void> {
  await withCaseLock(caseId, async (tx, kase) => {
    if (isTerminal(kase.status as never)) return;

    const subscription = await tx.query.subscriptions.findFirst({
      where: eq(subscriptions.id, kase.subscriptionId),
    });
    if (subscription && subscription.status === "cancelled") {
      await appendAudit(
        tx,
        {
          recoveryCaseId: caseId,
          subscriptionId: kase.subscriptionId,
          eventType: "STOPPED",
          payload: { reason: "subscription_cancelled" },
        },
        { status: "STOPPED" }
      );
      return;
    }

    if (kase.complaint) {
      await appendAudit(
        tx,
        {
          recoveryCaseId: caseId,
          subscriptionId: kase.subscriptionId,
          eventType: "ESCALATED",
          payload: { reason: "complaint" },
        },
        { status: "ESCALATED" }
      );
      return;
    }

    const ctx = await assembleContext(caseId, tx);

    let proposal: AgentProposal;
    let usedFallback = false;
    try {
      proposal = await proposeNextOperation(ctx);
    } catch {
      proposal = fallbackProposal(ctx);
      usedFallback = true;
      await appendAudit(tx, {
        recoveryCaseId: caseId,
        subscriptionId: kase.subscriptionId,
        eventType: "AGENT_DECISION",
        payload: { error: "AGENT_UNAVAILABLE" },
      });
    }

    if (!usedFallback) {
      await appendAudit(tx, {
        recoveryCaseId: caseId,
        subscriptionId: kase.subscriptionId,
        eventType: "AGENT_DECISION",
        payload: proposal,
      });
    }

    let policyResult = validate(ctx, proposal);
    await appendAudit(tx, {
      recoveryCaseId: caseId,
      subscriptionId: kase.subscriptionId,
      eventType: "POLICY_CHECK",
      payload: policyResult,
    });

    if (!policyResult.allowed && !usedFallback) {
      // Re-invoke the Agent once with the same context; if rejected again, fall back deterministically.
      try {
        proposal = await proposeNextOperation(ctx);
      } catch {
        proposal = fallbackProposal(ctx);
      }
      await appendAudit(tx, {
        recoveryCaseId: caseId,
        subscriptionId: kase.subscriptionId,
        eventType: "AGENT_DECISION",
        payload: { ...proposal, retry: true },
      });
      policyResult = validate(ctx, proposal);
      await appendAudit(tx, {
        recoveryCaseId: caseId,
        subscriptionId: kase.subscriptionId,
        eventType: "POLICY_CHECK",
        payload: { ...policyResult, retry: true },
      });
      if (!policyResult.allowed) {
        proposal = fallbackProposal(ctx);
      }
    }

    await dispatch(tx, caseId, kase, proposal, ctx.timing_context.next_billing_date);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function dispatch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  caseId: string,
  kase: { subscriptionId: string; retriesUsed: number; outreachUsed: number },
  proposal: AgentProposal,
  nextBillingDate: string | null
): Promise<void> {
  const actionId = randomUUID();
  const now = new Date();

  await tx.insert(recoveryActions).values({
    id: actionId,
    recoveryCaseId: caseId,
    operation: proposal.operation,
    timingStrategy: proposal.timing_strategy ?? null,
    reason: proposal.reason,
    status: "scheduled",
  });

  if (proposal.operation === "WAIT") {
    const dueAt = computeDueAt(proposal.timing_strategy!, now, nextBillingDate);
    await tx.insert(dueActions).values({ recoveryCaseId: caseId, dueAt, reason: "WAIT" });
    await tx
      .update(recoveryActions)
      .set({ status: "executed", executedAt: now, scheduledAt: dueAt })
      .where(eq(recoveryActions.id, actionId));
    await appendAudit(
      tx,
      {
        recoveryCaseId: caseId,
        subscriptionId: kase.subscriptionId,
        eventType: "ACTION_SCHEDULED",
        payload: { operation: "WAIT", timing_strategy: proposal.timing_strategy, due_at: dueAt.toISOString() },
      },
      { status: "WAITING" }
    );
    return;
  }

  if (proposal.operation === "ESCALATE") {
    await tx.update(recoveryActions).set({ status: "executed", executedAt: now }).where(eq(recoveryActions.id, actionId));
    await appendAudit(
      tx,
      {
        recoveryCaseId: caseId,
        subscriptionId: kase.subscriptionId,
        eventType: "ESCALATED",
        payload: { reason: proposal.reason },
      },
      { status: "ESCALATED" }
    );
    return;
  }

  if (proposal.operation === "STOP") {
    await tx.update(recoveryActions).set({ status: "executed", executedAt: now }).where(eq(recoveryActions.id, actionId));
    await appendAudit(
      tx,
      {
        recoveryCaseId: caseId,
        subscriptionId: kase.subscriptionId,
        eventType: "STOPPED",
        payload: { reason: proposal.reason },
      },
      { status: "STOPPED" }
    );
    return;
  }

  if (proposal.operation === "RETRY_PAYMENT") {
    const result = await execute(caseId, actionId, "RETRY_PAYMENT", tx);
    if (result.failed) {
      await appendAudit(tx, {
        recoveryCaseId: caseId,
        subscriptionId: kase.subscriptionId,
        eventType: "EXECUTION_FAILED",
        payload: { operation: "RETRY_PAYMENT" },
      });
      return;
    }
    await appendAudit(tx, {
      recoveryCaseId: caseId,
      subscriptionId: kase.subscriptionId,
      paymentId: result.paymentId,
      eventType: "ACTION_EXECUTED",
      payload: { operation: "RETRY_PAYMENT", payment_id: result.paymentId },
    });
    await appendAudit(
      tx,
      {
        recoveryCaseId: caseId,
        subscriptionId: kase.subscriptionId,
        paymentId: result.paymentId,
        eventType: "PAYMENT_OUTCOME",
        payload: { success: result.success, payment_id: result.paymentId },
      },
      {
        retriesUsed: kase.retriesUsed + 1,
        status: result.success ? "RETRYING" : "EVALUATING",
      }
    );
    return;
  }

  if (OUTREACH_LIKE.has(proposal.operation)) {
    const windowStart = nextCommunicationWindow(now);
    if (windowStart.getTime() > now.getTime()) {
      await tx.insert(dueActions).values({ recoveryCaseId: caseId, dueAt: windowStart, reason: "deferred_outreach" });
      await tx
        .update(recoveryActions)
        .set({ status: "executed", executedAt: now, scheduledAt: windowStart })
        .where(eq(recoveryActions.id, actionId));
      await appendAudit(
        tx,
        {
          recoveryCaseId: caseId,
          subscriptionId: kase.subscriptionId,
          eventType: "ACTION_SCHEDULED",
          payload: { operation: proposal.operation, deferred_to: windowStart.toISOString() },
        },
        { status: "WAITING" }
      );
      return;
    }

    const kind = proposal.operation as "OUTREACH" | "REQUEST_PAYMENT_METHOD_UPDATE" | "REQUEST_CUSTOMER_ACTION";
    const result = await execute(caseId, actionId, kind, tx);
    if (result.failed) {
      await appendAudit(tx, {
        recoveryCaseId: caseId,
        subscriptionId: kase.subscriptionId,
        eventType: "EXECUTION_FAILED",
        payload: { operation: kind },
      });
      return;
    }

    const newStatus =
      kind === "OUTREACH"
        ? "OUTREACH_PENDING"
        : kind === "REQUEST_PAYMENT_METHOD_UPDATE"
          ? "PAYMENT_METHOD_UPDATE_PENDING"
          : "CUSTOMER_ACTION_PENDING";
    const eventType = kind === "OUTREACH" ? "OUTREACH_SENT" : "REQUEST_SENT";

    await appendAudit(
      tx,
      {
        recoveryCaseId: caseId,
        subscriptionId: kase.subscriptionId,
        eventType,
        payload: { operation: kind, outreach_id: result.outreachId },
      },
      { outreachUsed: kase.outreachUsed + 1, status: newStatus }
    );
  }
}

/** External signal: payment.success always short-circuits to RECOVERED. */
export async function handlePaymentSuccess(caseId: string, paymentId: string): Promise<void> {
  await withCaseLock(caseId, async (tx, kase) => {
    if (isTerminal(kase.status as never)) return;
    await tx.delete(dueActions).where(eq(dueActions.recoveryCaseId, caseId));
    await appendAudit(
      tx,
      {
        recoveryCaseId: caseId,
        subscriptionId: kase.subscriptionId,
        paymentId,
        eventType: "PAYMENT_OUTCOME",
        payload: { success: true, payment_id: paymentId, source: "external" },
      },
      { status: "RECOVERED" }
    );
    await appendAudit(tx, {
      recoveryCaseId: caseId,
      subscriptionId: kase.subscriptionId,
      paymentId,
      eventType: "RECOVERED",
      payload: { payment_id: paymentId },
    });
  });
}

export async function handleComplaint(caseId: string): Promise<void> {
  await withCaseLock(caseId, async (tx, kase) => {
    if (isTerminal(kase.status as never)) return;
    await tx.delete(dueActions).where(eq(dueActions.recoveryCaseId, caseId));
    await appendAudit(
      tx,
      {
        recoveryCaseId: caseId,
        subscriptionId: kase.subscriptionId,
        eventType: "ESCALATED",
        payload: { reason: "complaint" },
      },
      { status: "ESCALATED", complaint: true }
    );
  });
}

export async function handleOptOut(caseId: string): Promise<void> {
  await withCaseLock(caseId, async (tx, kase) => {
    if (isTerminal(kase.status as never)) return;
    await appendAudit(
      tx,
      {
        recoveryCaseId: caseId,
        subscriptionId: kase.subscriptionId,
        eventType: "CUSTOMER_SIGNAL",
        payload: { opted_out: true },
      },
      { optedOut: true, status: "EVALUATING" }
    );
  });
  await evaluate(caseId);
}

export async function handleCancellation(subscriptionId: string): Promise<void> {
  await db
    .update(subscriptions)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(subscriptions.id, subscriptionId));

  const caseId = await findOpenCaseForSubscription(subscriptionId);
  if (!caseId) return;
  await withCaseLock(caseId, async (tx, kase) => {
    if (isTerminal(kase.status as never)) return;
    await tx.delete(dueActions).where(eq(dueActions.recoveryCaseId, caseId));
    await appendAudit(
      tx,
      {
        recoveryCaseId: caseId,
        subscriptionId: kase.subscriptionId,
        eventType: "STOPPED",
        payload: { reason: "cancellation" },
      },
      { status: "STOPPED" }
    );
  });
}

/** payment_method_updated / customer_action_completed arriving mid-wait -> immediate re-evaluation. */
export async function handleCustomerSignal(
  caseId: string,
  signal: { paymentMethodUpdated?: boolean; customerActionCompleted?: boolean }
): Promise<void> {
  await withCaseLock(caseId, async (tx, kase) => {
    if (isTerminal(kase.status as never)) return;
    await appendAudit(
      tx,
      {
        recoveryCaseId: caseId,
        subscriptionId: kase.subscriptionId,
        eventType: "CUSTOMER_SIGNAL",
        payload: {
          payment_method_updated: signal.paymentMethodUpdated,
          customer_action_completed: signal.customerActionCompleted,
        },
      },
      { status: "EVALUATING" }
    );
  });
  await evaluate(caseId);
}

/** Customer response to a plain OUTREACH send -> immediate re-evaluation. */
export async function handleOutreachResponse(caseId: string, response: string | null): Promise<void> {
  await withCaseLock(caseId, async (tx, kase) => {
    if (isTerminal(kase.status as never)) return;
    await appendAudit(
      tx,
      {
        recoveryCaseId: caseId,
        subscriptionId: kase.subscriptionId,
        eventType: "OUTREACH_RESULT",
        payload: { customer_response: response },
      },
      { status: "EVALUATING" }
    );
  });
  await evaluate(caseId);
}

export async function manualOverride(caseId: string, outcome: "RECOVERED" | "STOPPED", humanId: string, note?: string) {
  return withCaseLock(caseId, async (tx, kase) => {
    if (kase.status !== "ESCALATED") {
      throw new Error("CASE_NOT_ESCALATED");
    }
    await appendAudit(
      tx,
      {
        recoveryCaseId: caseId,
        subscriptionId: kase.subscriptionId,
        eventType: "MANUAL_OVERRIDE",
        payload: { outcome, human_id: humanId, note: note ?? null },
      },
      { status: outcome }
    );
    return { ...kase, status: outcome };
  });
}

/** Poller: fires due WAIT/deferred-outreach actions. */
export async function sweepDueActions(): Promise<void> {
  const now = new Date();
  const due = await db.select().from(dueActions).where(lte(dueActions.dueAt, now));
  for (const row of due) {
    await db.delete(dueActions).where(eq(dueActions.id, row.id));
    await evaluate(row.recoveryCaseId);
  }
}

/** Poller: force-transitions any non-terminal case past its deadline to EXHAUSTED. */
export async function sweepExhaustion(): Promise<void> {
  const now = new Date();
  const overdue = await db
    .select({ id: recoveryCases.id })
    .from(recoveryCases)
    .where(and(notInArray(recoveryCases.status, [...TERMINAL_STATUSES]), lte(recoveryCases.deadline, now)));

  for (const row of overdue) {
    await withCaseLock(row.id, async (tx, kase) => {
      if (isTerminal(kase.status as never)) return;
      await tx.delete(dueActions).where(eq(dueActions.recoveryCaseId, row.id));
      await appendAudit(
        tx,
        {
          recoveryCaseId: row.id,
          subscriptionId: kase.subscriptionId,
          eventType: "EXHAUSTED",
          payload: { reason: "deadline_passed" },
        },
        { status: "EXHAUSTED" }
      );
    });
  }
}
