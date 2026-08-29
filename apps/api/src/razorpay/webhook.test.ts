import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "node:crypto";
import { verifySignature } from "./webhook.js";
import { normalize } from "../normalizer/index.js";

const SECRET = "whsec_test_1234";

beforeAll(() => {
  process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
});

describe("razorpay webhook signature verification", () => {
  const body = Buffer.from(JSON.stringify({ event: "subscription.charged" }));
  const sign = (b: Buffer) => createHmac("sha256", SECRET).update(b).digest("hex");

  it("accepts a correctly signed body", () => {
    expect(verifySignature(body, sign(body))).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifySignature(Buffer.from(body.toString() + " "), sign(body))).toBe(false);
  });

  it("rejects a missing signature", () => {
    expect(verifySignature(body, undefined)).toBe(false);
  });

  it("rejects a wrong-length signature without throwing", () => {
    expect(verifySignature(body, "abc")).toBe(false);
  });
});

describe("razorpay error.reason normalization", () => {
  it.each([
    ["insufficient_funds", "SOFT_BALANCE"],
    ["payment_frequency_limit_exceeded", "SOFT_LIMIT"],
    ["issuer_down", "SOFT_TRANSIENT"],
    ["payment_authentication_failed", "CUSTOMER_ACTION"],
    ["card_number_incorrect", "PAYMENT_METHOD_INVALID"],
    ["payment_declined_by_bank_due_to_risk", "FRAUD_RISK"],
    ["subscription_halted", "UNKNOWN_DECLINE"],
  ])("maps reason %s -> %s", (reason, category) => {
    expect(normalize({ errorCode: "GATEWAY_ERROR", errorReason: reason })).toBe(category);
  });

  it("prefers errorReason over the coarse errorCode", () => {
    expect(normalize({ errorCode: "BAD_REQUEST_ERROR", errorReason: "insufficient_funds" })).toBe("SOFT_BALANCE");
  });
});
