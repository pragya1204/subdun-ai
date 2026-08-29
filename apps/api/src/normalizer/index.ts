import { normalizeCategory, type Category } from "@recovery/shared";

export interface RawFailureFields {
  errorCode: string | null | undefined;
  errorSource?: string | null;
  errorStep?: string | null;
  errorReason?: string | null;
}

/**
 * Deterministic error fields -> category. Pure function, no I/O.
 * Prefers the granular `errorReason` (real Razorpay puts the useful value there,
 * with a coarse code like BAD_REQUEST_ERROR in `errorCode`); falls back to `errorCode`
 * for the Simulator, which sets both to the same synthetic value.
 */
export function normalize(fields: RawFailureFields): Category {
  return normalizeCategory(fields.errorReason ?? fields.errorCode);
}
