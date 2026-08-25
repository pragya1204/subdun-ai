import { normalizeCategory, type Category } from "@recovery/shared";

export interface RawFailureFields {
  errorCode: string | null | undefined;
  errorSource?: string | null;
  errorStep?: string | null;
  errorReason?: string | null;
}

/** Deterministic error fields -> category. Pure function, no I/O. */
export function normalize(fields: RawFailureFields): Category {
  return normalizeCategory(fields.errorCode);
}
