/**
 * Thin wrapper over the Razorpay REST API (test mode). Uses global fetch so no SDK
 * dependency is added. Only the endpoints the adapter needs are exposed.
 */
import { RAZORPAY_API_BASE, authHeader } from "./config.js";
import { logger } from "../log.js";

const log = logger("razorpay/client");

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const started = Date.now();
  const res = await fetch(`${RAZORPAY_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  log(`${method} ${path} -> ${res.status} (${Date.now() - started}ms)`);
  if (!res.ok) {
    const desc = json?.error?.description ?? text ?? res.statusText;
    log.error(`${method} ${path} failed`, json?.error ?? text);
    throw new Error(`Razorpay ${method} ${path} -> ${res.status}: ${desc}`);
  }
  return json as T;
}

export interface RzpEntity {
  id: string;
  [k: string]: unknown;
}

export interface RzpPaymentLink extends RzpEntity {
  short_url: string;
  status: string;
  reference_id: string;
}

/** POST /v1/customers */
export function createCustomer(params: { name?: string; email?: string; contact?: string }) {
  return call<RzpEntity>("POST", "/customers", { ...params, fail_existing: 0 });
}

/** POST /v1/subscriptions */
export function createSubscription(params: {
  plan_id: string;
  total_count: number;
  customer_notify?: 0 | 1;
  notes?: Record<string, string>;
}) {
  return call<RzpEntity & { short_url: string; status: string }>("POST", "/subscriptions", params);
}

/** GET /v1/subscriptions/:id */
export function fetchSubscription(id: string) {
  return call<
    RzpEntity & {
      status: string;
      plan_id: string;
      customer_id?: string;
      current_end?: number;
      charge_at?: number;
    }
  >("GET", `/subscriptions/${id}`);
}

/** GET /v1/plans/:id */
export function fetchPlan(id: string) {
  return call<RzpEntity & { item: { amount: number; currency: string; name?: string } }>(
    "GET",
    `/plans/${id}`
  );
}

/**
 * Charge a subscription's saved token now (merchant-initiated / retry).
 * In test mode this is also exposed as the "Charge this Now" dashboard button.
 * Endpoint: POST /v1/subscriptions/:id/charge  (test mode) — returns a payment entity.
 */
export function chargeSubscription(id: string, params: { amount: number; currency?: string }) {
  return call<RzpEntity & { status: string }>("POST", `/subscriptions/${id}/charge`, {
    currency: "INR",
    ...params,
  });
}

/** POST /v1/payment_links */
export function createPaymentLink(params: {
  amount: number;
  currency?: string;
  description?: string;
  reference_id: string;
  customer?: { name?: string; email?: string; contact?: string };
  notify?: { sms?: boolean; email?: boolean };
  callback_url?: string;
  callback_method?: "get";
  notes?: Record<string, string>;
}) {
  return call<RzpPaymentLink>("POST", "/payment_links", {
    currency: "INR",
    ...params,
  });
}
