import {
  isTerminal,
  RETRY_BUDGET,
  OUTREACH_BUDGET,
  type AgentContext,
  type AgentProposal,
  type PolicyResult,
  type RejectionReason,
} from "@recovery/shared";
import { allowedPrimitives, allowedTimingStrategies } from "./categoryConfig.js";

type Check = (ctx: AgentContext, proposal: AgentProposal) => PolicyResult;

const terminalStateCheck: Check = (ctx) =>
  isTerminal(ctx.recovery_state.status)
    ? { allowed: false, reason: "TERMINAL_STATE" satisfies RejectionReason }
    : { allowed: true };

// Cancellation is enforced by the Orchestrator before the Agent/Policy are ever invoked
// (evaluate() checks subscription.status and force-STOPs the case first) — the same
// "structural enforcement point, not Policy" pattern used for the complaint check below.
const cancellationCheck: Check = () => ({ allowed: true });

const complaintCheck: Check = (ctx) =>
  ctx.customer_signals.complaint
    ? { allowed: false, reason: "COMPLAINT_ON_FILE" satisfies RejectionReason }
    : { allowed: true };

const categoryAllowListCheck: Check = (ctx, proposal) => {
  const category = ctx.current_failure.category;
  const primitives = allowedPrimitives(category);
  if (!primitives.includes(proposal.operation)) {
    return { allowed: false, reason: "NOT_IN_CATEGORY_ALLOWLIST" satisfies RejectionReason };
  }
  const needsTiming = proposal.operation === "WAIT";
  if (needsTiming) {
    const timing = allowedTimingStrategies(category);
    if (!proposal.timing_strategy || !timing.includes(proposal.timing_strategy)) {
      return { allowed: false, reason: "NOT_IN_CATEGORY_ALLOWLIST" satisfies RejectionReason };
    }
  }
  return { allowed: true };
};

const fraudRestrictionCheck: Check = (ctx, proposal) =>
  ctx.current_failure.category === "FRAUD_RISK" && proposal.operation === "RETRY_PAYMENT"
    ? { allowed: false, reason: "FRAUD_RETRY_FORBIDDEN" satisfies RejectionReason }
    : { allowed: true };

const paymentMethodPrerequisiteCheck: Check = (ctx, proposal) =>
  ctx.current_failure.category === "PAYMENT_METHOD_INVALID" &&
  proposal.operation === "RETRY_PAYMENT" &&
  ctx.customer_signals.payment_method_updated !== true
    ? { allowed: false, reason: "PAYMENT_METHOD_NOT_UPDATED" satisfies RejectionReason }
    : { allowed: true };

const customerActionPrerequisiteCheck: Check = (ctx, proposal) =>
  ctx.current_failure.category === "CUSTOMER_ACTION" &&
  proposal.operation === "RETRY_PAYMENT" &&
  ctx.customer_signals.customer_action_completed !== true
    ? { allowed: false, reason: "CUSTOMER_ACTION_NOT_COMPLETED" satisfies RejectionReason }
    : { allowed: true };

const retryBudgetCheck: Check = (ctx, proposal) =>
  proposal.operation === "RETRY_PAYMENT" && ctx.recovery_history.retries_used >= RETRY_BUDGET
    ? { allowed: false, reason: "RETRY_BUDGET_EXCEEDED" satisfies RejectionReason }
    : { allowed: true };

const OUTREACH_LIKE = new Set(["OUTREACH", "REQUEST_PAYMENT_METHOD_UPDATE", "REQUEST_CUSTOMER_ACTION"]);

const outreachBudgetCheck: Check = (ctx, proposal) =>
  OUTREACH_LIKE.has(proposal.operation) && ctx.recovery_history.outreach_used >= OUTREACH_BUDGET
    ? { allowed: false, reason: "OUTREACH_BUDGET_EXCEEDED" satisfies RejectionReason }
    : { allowed: true };

const optOutCheck: Check = (ctx, proposal) =>
  OUTREACH_LIKE.has(proposal.operation) && ctx.customer_signals.opted_out
    ? { allowed: false, reason: "OPTED_OUT" satisfies RejectionReason }
    : { allowed: true };

const deadlineCheck: Check = (ctx) => {
  const now = new Date(ctx.timing_context.now).getTime();
  const deadline = new Date(ctx.recovery_state.deadline).getTime();
  return now >= deadline
    ? { allowed: false, reason: "DEADLINE_PASSED" satisfies RejectionReason }
    : { allowed: true };
};

const CHECKS: Check[] = [
  terminalStateCheck,
  cancellationCheck,
  complaintCheck,
  categoryAllowListCheck,
  fraudRestrictionCheck,
  paymentMethodPrerequisiteCheck,
  customerActionPrerequisiteCheck,
  retryBudgetCheck,
  outreachBudgetCheck,
  optOutCheck,
  deadlineCheck,
];

/**
 * Pure function of (ctx, proposal). Never substitutes an alternative operation —
 * only Orchestrator decides what happens on rejection.
 */
export function validate(ctx: AgentContext, proposal: AgentProposal): PolicyResult {
  for (const check of CHECKS) {
    const result = check(ctx, proposal);
    if (!result.allowed) return result;
  }
  return { allowed: true };
}
