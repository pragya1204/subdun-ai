/**
 * Lazy Razorpay test-mode configuration. Nothing here runs at import time, so the
 * Simulator path and `pnpm test` are unaffected even when these env vars are absent.
 * Every getter throws only when actually called with a missing value.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set — required when PROVIDER=razorpay. See docs/Razorpay_Test_Mode_Integration.md §3.`
    );
  }
  return value;
}

export const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";

export function keyId(): string {
  return required("RAZORPAY_KEY_ID");
}

export function keySecret(): string {
  return required("RAZORPAY_KEY_SECRET");
}

export function webhookSecret(): string {
  return required("RAZORPAY_WEBHOOK_SECRET");
}

export function planId(): string {
  return required("RAZORPAY_PLAN_ID");
}

/** Tunnel / deployment origin, used for Payment Link callback URLs. Optional. */
export function publicBaseUrl(): string {
  return process.env.PUBLIC_BASE_URL ?? "http://localhost:4000";
}

/** HTTP Basic auth header value for api.razorpay.com. */
export function authHeader(): string {
  return "Basic " + Buffer.from(`${keyId()}:${keySecret()}`).toString("base64");
}
