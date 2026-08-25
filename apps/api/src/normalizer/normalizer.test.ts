import { describe, it, expect } from "vitest";
import { normalize } from "./index.js";

describe("normalizer", () => {
  it.each([
    ["insufficient_funds", "SOFT_BALANCE"],
    ["limit_exceeded", "SOFT_LIMIT"],
    ["issuer_unavailable", "SOFT_TRANSIENT"],
    ["otp_failed", "CUSTOMER_ACTION"],
    ["card_expired", "PAYMENT_METHOD_INVALID"],
    ["suspected_fraud", "FRAUD_RISK"],
  ])("maps %s -> %s", (code, category) => {
    expect(normalize({ errorCode: code })).toBe(category);
  });

  it("maps unknown codes to UNKNOWN_DECLINE", () => {
    expect(normalize({ errorCode: "some_unmapped_code" })).toBe("UNKNOWN_DECLINE");
  });

  it("maps missing error code to UNKNOWN_DECLINE", () => {
    expect(normalize({ errorCode: null })).toBe("UNKNOWN_DECLINE");
  });

  it("is deterministic", () => {
    expect(normalize({ errorCode: "insufficient_funds" })).toBe(normalize({ errorCode: "insufficient_funds" }));
  });
});
