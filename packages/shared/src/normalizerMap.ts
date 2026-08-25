import type { Category } from "./enums.js";

/**
 * Deterministic error_code -> category mapping (Failure Normalizer).
 * Same input always yields same output; anything not listed -> UNKNOWN_DECLINE.
 */
export const ERROR_CODE_CATEGORY_MAP: Record<string, Category> = {
  insufficient_funds: "SOFT_BALANCE",
  balance_insufficient: "SOFT_BALANCE",

  limit_exceeded: "SOFT_LIMIT",
  card_limit_exceeded: "SOFT_LIMIT",
  daily_limit_exceeded: "SOFT_LIMIT",

  issuer_unavailable: "SOFT_TRANSIENT",
  gateway_timeout: "SOFT_TRANSIENT",
  processing_error: "SOFT_TRANSIENT",
  bank_server_error: "SOFT_TRANSIENT",

  otp_failed: "CUSTOMER_ACTION",
  authentication_failed: "CUSTOMER_ACTION",
  otp_timeout: "CUSTOMER_ACTION",
  three_ds_failed: "CUSTOMER_ACTION",

  card_expired: "PAYMENT_METHOD_INVALID",
  invalid_card: "PAYMENT_METHOD_INVALID",
  card_declined: "PAYMENT_METHOD_INVALID",
  expired_card: "PAYMENT_METHOD_INVALID",

  suspected_fraud: "FRAUD_RISK",
  fraud_suspected: "FRAUD_RISK",
  risk_check_failed: "FRAUD_RISK",
};

export function normalizeCategory(errorCode: string | null | undefined): Category {
  if (!errorCode) return "UNKNOWN_DECLINE";
  return ERROR_CODE_CATEGORY_MAP[errorCode] ?? "UNKNOWN_DECLINE";
}
