import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { db } from "../db/client.js";
import { subscriptions, payments, outreach, recoveryCases } from "../db/schema.js";
import { ingestEvent } from "../intake/index.js";
import { webhookSecret } from "./config.js";
import { fetchSubscription, fetchPlan } from "./client.js";
import { logger } from "../log.js";
import type { ProviderEvent } from "@recovery/shared";

const log = logger("razorpay/webhook");

/** HMAC-SHA256 of the raw body, compared in constant time against X-Razorpay-Signature. */
export function verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", webhookSecret()).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

type Entity = Record<string, unknown>;
const ent = (rzp: Entity, path: string): Entity | undefined => {
  const node = (rzp.payload as Entity | undefined)?.[path] as Entity | undefined;
  return node?.entity as Entity | undefined;
};

function genId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * Create a local `subscriptions` mirror row for a Razorpay subscription that was
 * created outside our `POST /api/razorpay/subscriptions` helper (e.g. via the
 * Razorpay dashboard). Fetches amount/currency/customer from the Razorpay API.
 */
async function ensureLocalSubscription(rzpSubId: string) {
  const existing = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.providerRef, rzpSubId),
  });
  if (existing) return existing;

  log(`no local subscription for ${rzpSubId} — auto-provisioning from Razorpay`);
  const rzpSub = await fetchSubscription(rzpSubId);

  let amount = 0;
  let currency = "INR";
  try {
    const plan = await fetchPlan(rzpSub.plan_id);
    amount = Number(plan.item?.amount ?? 0);
    currency = plan.item?.currency ?? "INR";
  } catch (e) {
    log.warn(`could not fetch plan ${rzpSub.plan_id}`, e instanceof Error ? e.message : e);
  }

  const localId = genId("sub");
  const nextBilling = rzpSub.current_end
    ? new Date(rzpSub.current_end * 1000)
    : new Date(Date.now() + 30 * 86_400_000);

  await db
    .insert(subscriptions)
    .values({
      id: localId,
      customerId: rzpSub.customer_id ?? `cust_${rzpSubId}`,
      planId: rzpSub.plan_id,
      amount,
      currency,
      billingCycle: "monthly",
      nextBillingDate: nextBilling.toISOString().slice(0, 10),
      status: "active",
      paymentMethodId: "razorpay_token",
      provider: "razorpay",
      providerRef: rzpSubId,
    })
    .onConflictDoNothing({ target: subscriptions.id });

  const row = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.providerRef, rzpSubId),
  });
  log(`auto-provisioned local subscription ${row?.id} for ${rzpSubId}`, { amount, currency });
  return row;
}

async function resolveSub(rzpSubId: string | undefined) {
  if (!rzpSubId) return undefined;
  const found = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.providerRef, rzpSubId),
  });
  if (found) return found;
  try {
    return await ensureLocalSubscription(rzpSubId);
  } catch (e) {
    log.error(`failed to auto-provision subscription for ${rzpSubId}`, e instanceof Error ? e.message : e);
    return undefined;
  }
}

/**
 * Translate a verified Razorpay webhook body into the internal ProviderEvent
 * envelope. Returns null for events we deliberately don't act on.
 */
export async function translateEvent(
  rzp: Entity,
  ctx: { eventId: string }
): Promise<ProviderEvent | null> {
  const event = String(rzp.event ?? "");
  const nowIso = new Date().toISOString();

  switch (event) {
    case "subscription.charged": {
      const sub = ent(rzp, "subscription");
      const pay = ent(rzp, "payment");
      const local = await resolveSub(sub?.id as string | undefined);
      if (!local || !pay) {
        log.warn(`subscription.charged ignored`, { reason: !local ? "sub_not_found" : "no_payment_entity", sub_id: sub?.id });
        return null;
      }
      return {
        event_id: ctx.eventId,
        event_type: "payment.success",
        payload: {
          payment_id: pay.id as string,
          subscription_id: local.id,
          amount: Number(pay.amount ?? local.amount),
          currency: (pay.currency as string) ?? local.currency,
          method: (pay.method as string) ?? "card",
          status: "success",
          created_at: nowIso,
        },
      };
    }

    case "subscription.pending": {
      const sub = ent(rzp, "subscription");
      const pay = ent(rzp, "payment");
      const local = await resolveSub(sub?.id as string | undefined);
      if (!local) {
        log.warn(`subscription.pending ignored`, { reason: "sub_not_found", sub_id: sub?.id });
        return null;
      }
      return {
        event_id: ctx.eventId,
        event_type: "payment.failed",
        payload: {
          payment_id: (pay?.id as string) ?? `pay_pending_${ctx.eventId}`,
          subscription_id: local.id,
          amount: Number(pay?.amount ?? local.amount),
          currency: (pay?.currency as string) ?? local.currency,
          method: (pay?.method as string) ?? "card",
          status: "failed",
          error_code: (pay?.error_code as string) ?? "GATEWAY_ERROR",
          error_description: (pay?.error_description as string) ?? "Subscription charge failed",
          error_source: (pay?.error_source as string) ?? "bank",
          error_step: (pay?.error_step as string) ?? "payment_authorization",
          error_reason: (pay?.error_reason as string) ?? "payment_failed",
          created_at: nowIso,
        },
      };
    }

    case "subscription.halted": {
      const sub = ent(rzp, "subscription");
      const local = await resolveSub(sub?.id as string | undefined);
      if (!local) {
        log.warn(`subscription.halted ignored`, { reason: "sub_not_found", sub_id: sub?.id });
        return null;
      }
      return {
        event_id: ctx.eventId,
        event_type: "payment.failed",
        payload: {
          payment_id: `pay_halted_${ctx.eventId}`,
          subscription_id: local.id,
          amount: local.amount,
          currency: local.currency,
          method: "card",
          status: "failed",
          error_code: "GATEWAY_ERROR",
          error_description: "Razorpay subscription halted — all native retries exhausted",
          error_source: "bank",
          error_step: "payment_authorization",
          error_reason: "subscription_halted",
          created_at: nowIso,
        },
      };
    }

    case "subscription.cancelled": {
      const sub = ent(rzp, "subscription");
      const local = await resolveSub(sub?.id as string | undefined);
      if (!local) {
        log.warn(`subscription.cancelled ignored`, { reason: "sub_not_found", sub_id: sub?.id });
        return null;
      }
      return {
        event_id: ctx.eventId,
        event_type: "cancellation",
        payload: { subscription_id: local.id },
      };
    }

    case "payment_link.paid":
    case "payment_link.expired": {
      const link = ent(rzp, "payment_link");
      const pay = ent(rzp, "payment");
      const caseId = (link?.reference_id as string) ?? undefined;
      if (!caseId) {
        log.warn(`${event} ignored`, { reason: "no_reference_id", link_id: link?.id });
        return null;
      }
      const kase = await db.query.recoveryCases.findFirst({ where: eq(recoveryCases.id, caseId) });
      if (!kase) {
        log.warn(`${event} ignored`, { reason: "case_not_found", reference_id: caseId });
        return null;
      }

      let kind = (link?.notes as Entity | undefined)?.kind as string | undefined;
      if (!kind && link?.id) {
        const row = await db.query.outreach.findFirst({
          where: eq(outreach.providerRef, link.id as string),
        });
        kind = row?.kind;
      }

      const paid = event === "payment_link.paid";

      if (paid && kind === "REQUEST_PAYMENT_METHOD_UPDATE") {
        return {
          event_id: ctx.eventId,
          event_type: "payment_method_updated",
          payload: {
            subscription_id: kase.subscriptionId,
            payment_method_id: (pay?.id as string) ?? `pm_${ctx.eventId}`,
            updated: true,
          },
        };
      }
      if (paid && kind === "REQUEST_CUSTOMER_ACTION") {
        return {
          event_id: ctx.eventId,
          event_type: "customer_action_completed",
          payload: {
            subscription_id: kase.subscriptionId,
            recovery_case_id: caseId,
            completed: true,
          },
        };
      }
      return {
        event_id: ctx.eventId,
        event_type: "outreach.result",
        payload: {
          outreach_id: caseId,
          subscription_id: kase.subscriptionId,
          recovery_case_id: caseId,
          status: paid ? "delivered" : "failed",
          customer_response: paid ? "paid" : null,
        },
      };
    }

    // payment.failed / payment.captured standalone: the subscription context is
    // covered by subscription.pending / subscription.charged above.
    default:
      log.debug(`event not handled: ${event}`);
      return null;
  }
}

/** Ensure a payments row exists for a payment.failed / payment.success envelope (FK for recovery_cases). */
async function ensurePaymentRow(envelope: ProviderEvent): Promise<void> {
  if (envelope.event_type !== "payment.failed" && envelope.event_type !== "payment.success") return;
  const p = envelope.payload as Record<string, unknown>;
  await db
    .insert(payments)
    .values({
      id: p.payment_id as string,
      subscriptionId: p.subscription_id as string,
      amount: Number(p.amount ?? 0),
      currency: (p.currency as string) ?? "INR",
      method: (p.method as string) ?? "card",
      status: envelope.event_type === "payment.success" ? "success" : "failed",
      errorCode: (p.error_code as string | undefined) ?? null,
      errorDescription: (p.error_description as string | undefined) ?? null,
      errorSource: (p.error_source as string | undefined) ?? null,
      errorStep: (p.error_step as string | undefined) ?? null,
      errorReason: (p.error_reason as string | undefined) ?? null,
    })
    .onConflictDoNothing({ target: payments.id });
}

/** Express handler for POST /api/webhooks/razorpay. Mounted with express.raw, outside requireAuth. */
export async function razorpayWebhookHandler(req: Request, res: Response): Promise<void> {
  const raw = req.body as Buffer;
  if (!Buffer.isBuffer(raw)) {
    log.error("body is not a Buffer — express.raw not applied to this route?");
    res.status(400).json({ error: "raw_body_required" });
    return;
  }

  const eventId = req.header("X-Razorpay-Event-Id") ?? `rzp_${Date.now()}`;
  let peekEvent = "?";
  try {
    peekEvent = String(JSON.parse(raw.toString("utf8")).event ?? "?");
  } catch {
    /* logged below */
  }
  log(`received ${peekEvent}`, { event_id: eventId, bytes: raw.length });
  log.debug("raw body", raw.toString("utf8"));

  if (!verifySignature(raw, req.header("X-Razorpay-Signature"))) {
    log.warn(`signature FAIL for ${peekEvent} — RAZORPAY_WEBHOOK_SECRET does not match the dashboard webhook secret`);
    res.status(400).json({ error: "invalid_signature" });
    return;
  }
  log.debug("signature ok");

  let rzp: Entity;
  try {
    rzp = JSON.parse(raw.toString("utf8"));
  } catch {
    log.error("invalid JSON body");
    res.status(400).json({ error: "invalid_json" });
    return;
  }

  const envelope = await translateEvent(rzp, { eventId });
  if (!envelope) {
    log(`-> ignored (${peekEvent})`);
    res.status(200).json({ status: "ignored", event: rzp.event });
    return;
  }

  log(`-> internal ${envelope.event_type}`, envelope.payload);
  await ensurePaymentRow(envelope);
  const result = await ingestEvent(envelope);
  log(`-> ingest ${result.status}`, { event_id: envelope.event_id });
  res.status(200).json(result);
}
