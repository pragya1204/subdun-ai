import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { subscriptions, payments, outreach, recoveryCases } from "../db/schema.js";
import type { ProviderPort, PaymentResult, DeliveryResult } from "../simulator/port.js";
import { chargeSubscription, createPaymentLink } from "./client.js";
import { publicBaseUrl } from "./config.js";

/**
 * Real Razorpay (test mode) implementation of ProviderPort.
 *
 * - `retryPayment` issues a merchant-initiated charge against the subscription's
 *   saved token. The synchronous return is best-effort; the authoritative outcome
 *   arrives asynchronously as a `subscription.charged` / `subscription.pending`
 *   webhook routed through POST /api/webhooks/razorpay -> ingestEvent().
 * - `sendMessage` creates a Razorpay Payment Link; the customer response arrives
 *   as a `payment_link.paid` / `payment_link.expired` webhook.
 *
 * Nothing outside this module (and simulator/) knows which provider is bound.
 */
export const razorpayAdapter: ProviderPort = {
  async retryPayment({ subscriptionId, amount }): Promise<PaymentResult> {
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, subscriptionId),
    });
    if (!sub?.providerRef) {
      throw new Error(
        `Subscription ${subscriptionId} has no Razorpay provider_ref — provision it via POST /api/razorpay/subscriptions`
      );
    }

    const payment = await chargeSubscription(sub.providerRef, { amount, currency: sub.currency });
    const paymentId = payment.id;
    const status = String(payment.status ?? "");
    const success = status === "captured" || status === "authorized";

    // Mirror the Simulator: a payments row must exist for recovery_actions.payment_id (FK).
    await db
      .insert(payments)
      .values({
        id: paymentId,
        subscriptionId,
        amount,
        currency: sub.currency,
        method: "card",
        status: success ? "success" : "failed",
        errorReason: success ? null : (payment.error_reason as string | null) ?? "payment_failed",
        errorCode: success ? null : (payment.error_code as string | null) ?? null,
        errorDescription: success ? null : (payment.error_description as string | null) ?? null,
      })
      .onConflictDoNothing({ target: payments.id });

    return { success, paymentId };
  },

  async sendMessage({ recoveryCaseId, kind, template }): Promise<DeliveryResult> {
    const kase = await db.query.recoveryCases.findFirst({
      where: eq(recoveryCases.id, recoveryCaseId),
    });
    if (!kase) throw new Error(`Recovery case ${recoveryCaseId} not found`);
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, kase.subscriptionId),
    });

    const link = await createPaymentLink({
      amount: sub?.amount ?? 0,
      currency: sub?.currency ?? "INR",
      description: template,
      reference_id: recoveryCaseId,
      notify: { sms: true, email: true },
      callback_url: `${publicBaseUrl()}/health`,
      callback_method: "get",
      notes: { kind, recovery_case_id: recoveryCaseId, subscription_id: kase.subscriptionId },
    });

    // Stash the link id on the most recent outreach row for this case so the
    // payment_link webhook can be correlated even across restarts.
    const latest = await db
      .select({ id: outreach.id })
      .from(outreach)
      .where(eq(outreach.recoveryCaseId, recoveryCaseId))
      .orderBy(outreach.sentAt);
    const target = latest.at(-1);
    if (target) {
      await db.update(outreach).set({ providerRef: link.id }).where(eq(outreach.id, target.id));
    }

    return { delivered: link.status !== "cancelled" };
  },
};
