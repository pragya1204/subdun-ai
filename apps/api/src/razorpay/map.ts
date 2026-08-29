import type { Category } from "@recovery/shared";
import { normalizeCategory } from "@recovery/shared";

/**
 * Razorpay `error.reason` -> internal Category. Delegates to the shared map
 * (which now carries real Razorpay reason keys); kept as a named seam so the
 * Razorpay-specific fallback lives in one place.
 */
export function categoryForRazorpayReason(reason: string | null | undefined): Category {
  return normalizeCategory(reason);
}

/** Razorpay webhook event types this integration subscribes to. */
export const SUBSCRIBED_EVENTS = [
  "payment.failed",
  "payment.captured",
  "subscription.charged",
  "subscription.pending",
  "subscription.halted",
  "subscription.cancelled",
  "payment_link.paid",
  "payment_link.expired",
] as const;
