import { describe, it, expect } from "vitest";
import { validate } from "./index.js";
import type { AgentContext, AgentProposal, Category } from "@recovery/shared";

function ctx(overrides: Partial<AgentContext> = {}, category: Category = "SOFT_TRANSIENT"): AgentContext {
  const now = new Date("2026-01-10T12:00:00Z");
  const deadline = new Date("2026-01-24T12:00:00Z");
  return {
    current_failure: { category, error_code: "issuer_unavailable", amount: 999, failed_at: now.toISOString() },
    recovery_history: { retries_used: 0, outreach_used: 0, prior_actions: [] },
    subscription_history: { successful_payments: 5, failed_payments: 1, previous_failures: [] },
    recovery_state: { status: "EVALUATING", days_since_failure: 0, deadline: deadline.toISOString() },
    customer_signals: { opted_out: false, complaint: false, payment_method_updated: null, customer_action_completed: null },
    timing_context: { now: now.toISOString(), next_billing_date: null, days_remaining: 14 },
    allowed_primitives: ["WAIT", "RETRY_PAYMENT", "OUTREACH", "ESCALATE", "STOP"],
    allowed_timing_strategies: ["WAIT_6H", "WAIT_24H", "WAIT_72H"],
    ...overrides,
  };
}

function proposal(overrides: Partial<AgentProposal> = {}): AgentProposal {
  return { operation: "WAIT", timing_strategy: "WAIT_24H", reason: "test", confidence: 0.9, ...overrides };
}

describe("policy.validate", () => {
  it("allows a valid proposal", () => {
    expect(validate(ctx(), proposal()).allowed).toBe(true);
  });

  it("rejects on terminal state", () => {
    const result = validate(ctx({ recovery_state: { status: "RECOVERED", days_since_failure: 1, deadline: "2026-01-24T12:00:00Z" } }), proposal());
    expect(result).toEqual({ allowed: false, reason: "TERMINAL_STATE" });
  });

  it("rejects on complaint", () => {
    const result = validate(
      ctx({ customer_signals: { opted_out: false, complaint: true, payment_method_updated: null, customer_action_completed: null } }),
      proposal()
    );
    expect(result.reason).toBe("COMPLAINT_ON_FILE");
  });

  it("rejects operation not in category allow-list", () => {
    const result = validate(ctx({}, "FRAUD_RISK"), proposal({ operation: "RETRY_PAYMENT" }));
    expect(result.reason).toBe("NOT_IN_CATEGORY_ALLOWLIST");
  });

  it("always allows ESCALATE/STOP regardless of category", () => {
    expect(validate(ctx({}, "FRAUD_RISK"), proposal({ operation: "ESCALATE", timing_strategy: undefined })).allowed).toBe(true);
    expect(validate(ctx({}, "FRAUD_RISK"), proposal({ operation: "STOP", timing_strategy: undefined })).allowed).toBe(true);
  });

  it("blocks RETRY_PAYMENT for FRAUD_RISK regardless of budget", () => {
    const result = validate(ctx({}, "FRAUD_RISK"), proposal({ operation: "RETRY_PAYMENT", timing_strategy: undefined }));
    expect(result.reason).toBe("NOT_IN_CATEGORY_ALLOWLIST");
  });

  it("blocks RETRY_PAYMENT for PAYMENT_METHOD_INVALID until updated", () => {
    const result = validate(
      ctx(
        { customer_signals: { opted_out: false, complaint: false, payment_method_updated: false, customer_action_completed: null } },
        "PAYMENT_METHOD_INVALID"
      ),
      proposal({ operation: "RETRY_PAYMENT", timing_strategy: undefined })
    );
    expect(result.reason).toBe("PAYMENT_METHOD_NOT_UPDATED");
  });

  it("allows RETRY_PAYMENT for PAYMENT_METHOD_INVALID once updated", () => {
    const result = validate(
      ctx(
        { customer_signals: { opted_out: false, complaint: false, payment_method_updated: true, customer_action_completed: null } },
        "PAYMENT_METHOD_INVALID"
      ),
      proposal({ operation: "RETRY_PAYMENT", timing_strategy: undefined })
    );
    expect(result.allowed).toBe(true);
  });

  it("blocks RETRY_PAYMENT for CUSTOMER_ACTION until completed", () => {
    const result = validate(ctx({}, "CUSTOMER_ACTION"), proposal({ operation: "RETRY_PAYMENT", timing_strategy: undefined }));
    expect(result.reason).toBe("CUSTOMER_ACTION_NOT_COMPLETED");
  });

  it("rejects RETRY_PAYMENT once retry budget exceeded", () => {
    const result = validate(
      ctx({ recovery_history: { retries_used: 2, outreach_used: 0, prior_actions: [] } }),
      proposal({ operation: "RETRY_PAYMENT", timing_strategy: undefined })
    );
    expect(result.reason).toBe("RETRY_BUDGET_EXCEEDED");
  });

  it("rejects OUTREACH once outreach budget exceeded", () => {
    const result = validate(
      ctx({ recovery_history: { retries_used: 0, outreach_used: 3, prior_actions: [] } }),
      proposal({ operation: "OUTREACH", timing_strategy: undefined })
    );
    expect(result.reason).toBe("OUTREACH_BUDGET_EXCEEDED");
  });

  it("opt-out blocks OUTREACH but not RETRY_PAYMENT", () => {
    const optedOutCtx = ctx({ customer_signals: { opted_out: true, complaint: false, payment_method_updated: null, customer_action_completed: null } });
    expect(validate(optedOutCtx, proposal({ operation: "OUTREACH", timing_strategy: undefined })).reason).toBe("OPTED_OUT");
    expect(validate(optedOutCtx, proposal({ operation: "RETRY_PAYMENT", timing_strategy: undefined })).allowed).toBe(true);
  });

  it("rejects once deadline has passed", () => {
    const result = validate(
      ctx({ timing_context: { now: "2026-01-25T00:00:00Z", next_billing_date: null, days_remaining: -1 } }),
      proposal()
    );
    expect(result.reason).toBe("DEADLINE_PASSED");
  });
});
