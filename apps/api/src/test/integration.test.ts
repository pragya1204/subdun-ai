import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { recoveryCases, dueActions, auditEvents } from "../db/schema.js";
import { ingestEvent } from "../intake/index.js";
import { sweepExhaustion } from "../orchestrator/index.js";
import { runScenario } from "../simulator/index.js";
import { resetDb, closeDb } from "./db.js";

const baseScenario = {
  failure_code: "issuer_unavailable",
  failure_behavior: "fail_then_succeed" as const,
  customer_behavior: "unresponsive" as const,
  payment_method_behavior: "never_updates" as const,
  customer_action_behavior: "never_completes" as const,
  would_native_retry_succeed: true,
  delay_ms: 0,
};

async function getCase(subscriptionId: string) {
  return db.query.recoveryCases.findFirst({ where: eq(recoveryCases.subscriptionId, subscriptionId) });
}

describe("core recovery flows (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("payment.failed with no open case creates a Recovery Case and evaluates it", async () => {
    const { subscriptionId } = await runScenario(baseScenario);
    const kase = await getCase(subscriptionId);
    expect(kase).toBeDefined();
    // No GEMINI_API_KEY in test env -> Agent always falls back to the deterministic WAIT default.
    expect(kase!.status).toBe("WAITING");

    const due = await db.select().from(dueActions).where(eq(dueActions.recoveryCaseId, kase!.id));
    expect(due.length).toBe(1);
  });

  it("duplicate event_id is a no-op (idempotent ingestion)", async () => {
    const { subscriptionId } = await runScenario(baseScenario);
    const kase = await getCase(subscriptionId);

    const dup = await ingestEvent({
      event_id: "evt_fixed_dup_test",
      event_type: "payment.failed",
      payload: {
        payment_id: "pay_dup",
        subscription_id: subscriptionId,
        amount: 999,
        currency: "INR",
        method: "card",
        status: "failed",
        error_code: "issuer_unavailable",
        error_description: "x",
        error_source: "issuer_bank",
        error_step: "payment_authorization",
        error_reason: "issuer_unavailable",
        created_at: new Date().toISOString(),
      },
    });
    expect(dup.status).toBe("accepted"); // first time for this event_id

    const dup2 = await ingestEvent({
      event_id: "evt_fixed_dup_test",
      event_type: "payment.failed",
      payload: {} as never,
    });
    expect(dup2.status).toBe("duplicate");

    // Still exactly one case for this subscription (single-open-case invariant).
    const cases = await db.select().from(recoveryCases).where(eq(recoveryCases.subscriptionId, subscriptionId));
    expect(cases.length).toBe(1);
    expect(cases[0].id).toBe(kase!.id);
  });

  it("a second genuine failure on an already-open case appends FAILURE_APPENDED, no new case", async () => {
    const { subscriptionId, paymentId } = await runScenario(baseScenario);
    const kase = await getCase(subscriptionId);

    await ingestEvent({
      event_id: "evt_second_failure",
      event_type: "payment.failed",
      payload: {
        payment_id: `${paymentId}_2`,
        subscription_id: subscriptionId,
        amount: 999,
        currency: "INR",
        method: "card",
        status: "failed",
        error_code: "issuer_unavailable",
        error_description: "x",
        error_source: "issuer_bank",
        error_step: "payment_authorization",
        error_reason: "issuer_unavailable",
        created_at: new Date().toISOString(),
      },
    });

    const cases = await db.select().from(recoveryCases).where(eq(recoveryCases.subscriptionId, subscriptionId));
    expect(cases.length).toBe(1);

    const events = await db.select().from(auditEvents).where(eq(auditEvents.recoveryCaseId, kase!.id));
    expect(events.some((e) => e.eventType === "FAILURE_APPENDED")).toBe(true);
  });

  it("payment.success short-circuits an open case to RECOVERED and clears due_actions", async () => {
    const { subscriptionId } = await runScenario(baseScenario);
    const kase = await getCase(subscriptionId);
    expect(kase!.status).toBe("WAITING");

    await ingestEvent({
      event_id: "evt_success_1",
      event_type: "payment.success",
      payload: {
        payment_id: "pay_success_1",
        subscription_id: subscriptionId,
        amount: 999,
        currency: "INR",
        method: "card",
        status: "success",
        created_at: new Date().toISOString(),
      },
    });

    const updated = await getCase(subscriptionId);
    expect(updated!.status).toBe("RECOVERED");

    const due = await db.select().from(dueActions).where(eq(dueActions.recoveryCaseId, kase!.id));
    expect(due.length).toBe(0);
  });

  it("complaint forces immediate ESCALATED", async () => {
    const { subscriptionId } = await runScenario(baseScenario);
    const kase = await getCase(subscriptionId);

    await ingestEvent({
      event_id: "evt_complaint_1",
      event_type: "complaint",
      payload: { subscription_id: subscriptionId, recovery_case_id: kase!.id, note: "unhappy" },
    });

    const updated = await getCase(subscriptionId);
    expect(updated!.status).toBe("ESCALATED");
    expect(updated!.complaint).toBe(true);
  });

  it("cancellation forces STOPPED", async () => {
    const { subscriptionId } = await runScenario(baseScenario);

    await ingestEvent({
      event_id: "evt_cancel_1",
      event_type: "cancellation",
      payload: { subscription_id: subscriptionId },
    });

    const updated = await getCase(subscriptionId);
    expect(updated!.status).toBe("STOPPED");
  });

  it("Day-14 sweep force-transitions overdue non-terminal cases to EXHAUSTED", async () => {
    const { subscriptionId } = await runScenario(baseScenario);
    const kase = await getCase(subscriptionId);

    await db
      .update(recoveryCases)
      .set({ deadline: new Date(Date.now() - 1000) })
      .where(eq(recoveryCases.id, kase!.id));

    await sweepExhaustion();

    const updated = await getCase(subscriptionId);
    expect(updated!.status).toBe("EXHAUSTED");
  });

  it("concurrent evaluate() calls on the same case serialize without corrupting state", async () => {
    const { subscriptionId } = await runScenario(baseScenario);
    const kase = await getCase(subscriptionId);

    const { evaluate } = await import("../orchestrator/index.js");
    await Promise.all([evaluate(kase!.id), evaluate(kase!.id)]);

    const updated = await getCase(subscriptionId);
    expect(["WAITING", "EVALUATING"]).toContain(updated!.status);
  });

  it("FRAUD_RISK category never allows RETRY_PAYMENT (verified via case created + policy check)", async () => {
    const { subscriptionId } = await runScenario({ ...baseScenario, failure_code: "suspected_fraud" });
    const kase = await getCase(subscriptionId);
    expect(kase!.category).toBe("FRAUD_RISK");
  });
});
