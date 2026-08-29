import { randomUUID } from "node:crypto";
import { db } from "../db/client.js";
import { subscriptions } from "../db/schema.js";
import { createCustomer, createSubscription } from "./client.js";
import { planId } from "./config.js";

function genId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * Demo helper: creates a real Razorpay test-mode customer + subscription, inserts
 * the local mirror row (provider = razorpay, provider_ref = sub_...), and returns
 * the short_url the operator opens to authenticate with a test card.
 *
 * The first real `payment.failed` then arrives via webhook once the operator uses
 * Dashboard -> the subscription -> "Charge this Now -> Failure".
 */
export async function provisionRazorpaySubscription(params: {
  customerId?: string;
  amount?: number;
}): Promise<{
  subscription_id: string;
  razorpay_subscription_id: string;
  short_url: string;
}> {
  const localId = genId("sub");
  const customerId = params.customerId ?? genId("cust");
  const amount = params.amount ?? 99900;

  const customer = await createCustomer({
    name: customerId,
    email: `${customerId}@example.test`,
    contact: "+919999999999",
  });

  const sub = await createSubscription({
    plan_id: planId(),
    total_count: 12,
    customer_notify: 1,
    notes: { local_subscription_id: localId, customer_id: customer.id },
  });

  const now = new Date();
  const nextBillingDate = new Date(now);
  nextBillingDate.setDate(nextBillingDate.getDate() + 30);

  await db.insert(subscriptions).values({
    id: localId,
    customerId: customer.id,
    planId: planId(),
    amount,
    currency: "INR",
    billingCycle: "monthly",
    nextBillingDate: nextBillingDate.toISOString().slice(0, 10),
    status: "active",
    paymentMethodId: "pending_authentication",
    provider: "razorpay",
    providerRef: sub.id,
  });

  return {
    subscription_id: localId,
    razorpay_subscription_id: sub.id,
    short_url: sub.short_url,
  };
}
