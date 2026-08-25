import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { ingestedEvents, subscriptions } from "../db/schema.js";
import { normalize } from "../normalizer/index.js";
import {
  createCase,
  appendFailureToCase,
  findOpenCaseForSubscription,
  handlePaymentSuccess,
  handleCustomerSignal,
  handleOutreachResponse,
  handleOptOut,
  handleComplaint,
  handleCancellation,
  evaluate,
} from "../orchestrator/index.js";
import type { ProviderEvent } from "@recovery/shared";

export interface IngestResult {
  status: "accepted" | "duplicate";
}

/** Receives Simulator events, dedupes, translates to internal commands. */
export async function ingestEvent(raw: ProviderEvent): Promise<IngestResult> {
  const inserted = await db
    .insert(ingestedEvents)
    .values({
      eventId: raw.event_id,
      eventType: raw.event_type,
      payload: raw.payload as object,
    })
    .onConflictDoNothing({ target: ingestedEvents.eventId })
    .returning({ eventId: ingestedEvents.eventId });

  if (inserted.length === 0) {
    return { status: "duplicate" };
  }

  await route(raw);
  return { status: "accepted" };
}

async function route(raw: ProviderEvent): Promise<void> {
  const payload = raw.payload as Record<string, unknown>;

  switch (raw.event_type) {
    case "payment.failed": {
      const subscriptionId = payload.subscription_id as string;
      const paymentId = payload.payment_id as string;
      const category = normalize({ errorCode: payload.error_code as string | undefined });

      const existingCaseId = await findOpenCaseForSubscription(subscriptionId);
      if (existingCaseId) {
        await appendFailureToCase({
          caseId: existingCaseId,
          subscriptionId,
          paymentId,
          errorFields: payload,
        });
      } else {
        const caseId = await createCase({
          subscriptionId,
          paymentId,
          category,
          errorFields: payload,
        });
        await evaluate(caseId);
      }
      return;
    }

    case "payment.success": {
      const subscriptionId = payload.subscription_id as string;
      const paymentId = payload.payment_id as string;
      const caseId = await findOpenCaseForSubscription(subscriptionId);
      if (caseId) await handlePaymentSuccess(caseId, paymentId);
      return;
    }

    case "subscription.updated": {
      const subscriptionId = payload.subscription_id as string;
      await db
        .update(subscriptions)
        .set({
          status: payload.status as string,
          nextBillingDate: payload.next_billing_date as string,
          paymentMethodId: payload.payment_method_id as string,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, subscriptionId));
      return;
    }

    case "payment_method_updated": {
      const subscriptionId = payload.subscription_id as string;
      const caseId = await findOpenCaseForSubscription(subscriptionId);
      if (caseId) {
        await handleCustomerSignal(caseId, { paymentMethodUpdated: payload.updated as boolean });
      }
      return;
    }

    case "customer_action_completed": {
      const caseId = payload.recovery_case_id as string;
      if (caseId) {
        await handleCustomerSignal(caseId, { customerActionCompleted: payload.completed as boolean });
      }
      return;
    }

    case "outreach.result": {
      const caseId = payload.recovery_case_id as string | undefined;
      if (caseId) {
        await handleOutreachResponse(caseId, (payload.customer_response as string | null) ?? null);
      }
      return;
    }

    case "opt_out": {
      const caseId = payload.recovery_case_id as string;
      if (caseId) await handleOptOut(caseId);
      return;
    }

    case "complaint": {
      const caseId = payload.recovery_case_id as string;
      if (caseId) await handleComplaint(caseId);
      return;
    }

    case "cancellation": {
      const subscriptionId = payload.subscription_id as string;
      await handleCancellation(subscriptionId);
      return;
    }
  }
}
