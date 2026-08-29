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

  // --- real Razorpay error.reason values (used when PROVIDER=razorpay) ---
  payment_failed: "UNKNOWN_DECLINE",
  payment_frequency_limit_exceeded: "SOFT_LIMIT",
  payment_method_limit_exhausted: "SOFT_LIMIT",
  transaction_limit_exceeded: "SOFT_LIMIT",
  issuer_down: "SOFT_TRANSIENT",
  gateway_technical_error: "SOFT_TRANSIENT",
  server_error: "SOFT_TRANSIENT",
  payment_authentication_failed: "CUSTOMER_ACTION",
  "3ds_failed": "CUSTOMER_ACTION",
  otp_incorrect: "CUSTOMER_ACTION",
  otp_attempts_exceeded: "CUSTOMER_ACTION",
  card_number_incorrect: "PAYMENT_METHOD_INVALID",
  incorrect_cvc: "PAYMENT_METHOD_INVALID",
  payment_method_blocked: "PAYMENT_METHOD_INVALID",
  international_transaction_not_allowed: "PAYMENT_METHOD_INVALID",
  payment_declined_by_bank_due_to_risk: "FRAUD_RISK",
  subscription_halted: "UNKNOWN_DECLINE",
};

export function normalizeCategory(errorCode: string | null | undefined): Category {
  if (!errorCode) return "UNKNOWN_DECLINE";
  return ERROR_CODE_CATEGORY_MAP[errorCode] ?? "UNKNOWN_DECLINE";
}
