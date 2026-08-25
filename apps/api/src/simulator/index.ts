import { randomUUID } from "node:crypto";
import { db } from "../db/client.js";
import { subscriptions, payments } from "../db/schema.js";
import type { ScenarioConfig } from "@recovery/shared";
import type { ProviderPort, PaymentResult, DeliveryResult } from "./port.js";
import { registerScenario, getScenario, recordRetryAttempt } from "./scenario.js";
import { ingestEvent } from "../intake/index.js";

function genId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** Creates a subscription + failed payment for a new scenario and emits payment.failed. */
export async function runScenario(
  config: ScenarioConfig
): Promise<{ subscriptionId: string; paymentId: string }> {
  const subscriptionId = genId("sub");
  const customerId = genId("cust");
  const paymentId = genId("pay");
  const amount = config.amount ?? 999;
  const now = new Date();
  const nextBillingDate = new Date(now);
  nextBillingDate.setDate(nextBillingDate.getDate() + 30);

  await db.insert(subscriptions).values({
    id: subscriptionId,
    customerId,
    planId: "plan_default",
    amount,
    currency: "INR",
    billingCycle: "monthly",
    nextBillingDate: nextBillingDate.toISOString().slice(0, 10),
    status: "active",
    paymentMethodId: genId("pm"),
  });

  await db.insert(payments).values({
    id: paymentId,
    subscriptionId,
    amount,
    currency: "INR",
    method: "card",
    status: "failed",
    errorCode: config.failure_code,
    errorDescription: `Simulated failure: ${config.failure_code}`,
    errorSource: "issuer_bank",
    errorStep: "payment_authorization",
    errorReason: config.failure_code,
  });

  registerScenario(subscriptionId, config);

  await ingestEvent({
    event_id: genId("evt"),
    event_type: "payment.failed",
    payload: {
      payment_id: paymentId,
      subscription_id: subscriptionId,
      amount,
      currency: "INR",
      method: "card",
      status: "failed",
      error_code: config.failure_code,
      error_description: `Simulated failure: ${config.failure_code}`,
      error_source: "issuer_bank",
      error_step: "payment_authorization",
      error_reason: config.failure_code,
      created_at: now.toISOString(),
    },
  });

  return { subscriptionId, paymentId };
}

function scheduleFollowUp(fn: () => void | Promise<void>, delayMs: number): void {
  setTimeout(() => {
    void fn();
  }, delayMs);
}

/** The only ProviderPort implementation for the MVP. Deterministic, no real network calls. */
export const simulatorAdapter: ProviderPort = {
  async retryPayment({ subscriptionId, amount, paymentMethodId }): Promise<PaymentResult> {
    const scenario = getScenario(subscriptionId);
    const attempt = recordRetryAttempt(subscriptionId);
    const paymentId = genId("pay");

    let success: boolean;
    if (!scenario) {
      success = false;
    } else if (scenario.failure_behavior === "always_succeed") {
      success = true;
    } else if (scenario.failure_behavior === "always_fail") {
      success = false;
    } else {
      // fail_then_succeed
      success = attempt >= 2;
    }

    await db.insert(payments).values({
      id: paymentId,
      subscriptionId,
      amount,
      currency: "INR",
      method: "card",
      status: success ? "success" : "failed",
      errorCode: success ? null : scenario?.failure_code ?? "unknown_decline",
      errorDescription: success ? null : "Simulated retry failure",
      errorSource: success ? null : "issuer_bank",
      errorStep: success ? null : "payment_authorization",
      errorReason: success ? null : scenario?.failure_code ?? "unknown_decline",
    });

    if (success) {
      scheduleFollowUp(async () => {
        await ingestEvent({
          event_id: genId("evt"),
          event_type: "payment.success",
          payload: {
            payment_id: paymentId,
            subscription_id: subscriptionId,
            amount,
            currency: "INR",
            method: "card",
            status: "success",
            created_at: new Date().toISOString(),
          },
        });
      }, 0);
    }

    return { success, paymentId };
  },

  async sendMessage({ recoveryCaseId, subscriptionId, kind }): Promise<DeliveryResult> {
    const scenario = getScenario(subscriptionId);
    const delayMs = scenario?.delay_ms ?? 0;

    scheduleFollowUp(async () => {
      if (!scenario) return;

      if (scenario.customer_behavior === "complains") {
        await ingestEvent({
          event_id: genId("evt"),
          event_type: "complaint",
          payload: { subscription_id: subscriptionId, recovery_case_id: recoveryCaseId, note: "Simulated complaint" },
        });
        return;
      }
      if (scenario.customer_behavior === "opts_out") {
        await ingestEvent({
          event_id: genId("evt"),
          event_type: "opt_out",
          payload: { subscription_id: subscriptionId, recovery_case_id: recoveryCaseId },
        });
        return;
      }

      if (kind === "REQUEST_PAYMENT_METHOD_UPDATE") {
        await ingestEvent({
          event_id: genId("evt"),
          event_type: "payment_method_updated",
          payload: {
            subscription_id: subscriptionId,
            payment_method_id: genId("pm"),
            updated: scenario.payment_method_behavior === "updates",
          },
        });
        return;
      }

      if (kind === "REQUEST_CUSTOMER_ACTION") {
        await ingestEvent({
          event_id: genId("evt"),
          event_type: "customer_action_completed",
          payload: {
            subscription_id: subscriptionId,
            recovery_case_id: recoveryCaseId,
            completed: scenario.customer_action_behavior === "completes",
          },
        });
        return;
      }

      // plain OUTREACH: simulate a customer response if "responsive"
      if (scenario.customer_behavior === "responsive") {
        await ingestEvent({
          event_id: genId("evt"),
          event_type: "outreach.result",
          payload: {
            outreach_id: recoveryCaseId,
            subscription_id: subscriptionId,
            recovery_case_id: recoveryCaseId,
            status: "delivered",
            customer_response: "ok, will check",
          },
        });
      }
    }, delayMs);

    return { delivered: true };
  },
};
