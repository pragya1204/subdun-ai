export const CATEGORIES = [
  "SOFT_BALANCE",
  "SOFT_LIMIT",
  "SOFT_TRANSIENT",
  "CUSTOMER_ACTION",
  "PAYMENT_METHOD_INVALID",
  "FRAUD_RISK",
  "UNKNOWN_DECLINE",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const OPERATIONS = [
  "WAIT",
  "RETRY_PAYMENT",
  "OUTREACH",
  "REQUEST_PAYMENT_METHOD_UPDATE",
  "REQUEST_CUSTOMER_ACTION",
  "ESCALATE",
  "STOP",
] as const;
export type Operation = (typeof OPERATIONS)[number];

export const TIMING_STRATEGIES = [
  "WAIT_6H",
  "WAIT_24H",
  "WAIT_72H",
  "NEXT_PAYDAY",
  "IMMEDIATE",
] as const;
export type TimingStrategy = (typeof TIMING_STRATEGIES)[number];

export const CASE_STATUSES = [
  "FAILED",
  "EVALUATING",
  "WAITING",
  "RETRYING",
  "OUTREACH_PENDING",
  "PAYMENT_METHOD_UPDATE_PENDING",
  "CUSTOMER_ACTION_PENDING",
  "RECOVERED",
  "ESCALATED",
  "EXHAUSTED",
  "STOPPED",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const TERMINAL_STATUSES: readonly CaseStatus[] = [
  "RECOVERED",
  "ESCALATED",
  "EXHAUSTED",
  "STOPPED",
];

export function isTerminal(status: CaseStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export const AUDIT_EVENT_TYPES = [
  "FAILURE_RECEIVED",
  "FAILURE_APPENDED",
  "AGENT_DECISION",
  "POLICY_CHECK",
  "ACTION_SCHEDULED",
  "ACTION_EXECUTED",
  "EXECUTION_FAILED",
  "PAYMENT_OUTCOME",
  "OUTREACH_SENT",
  "REQUEST_SENT",
  "OUTREACH_RESULT",
  "CUSTOMER_SIGNAL",
  "ESCALATED",
  "STOPPED",
  "EXHAUSTED",
  "RECOVERED",
  "MANUAL_OVERRIDE",
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export const REJECTION_REASONS = [
  "TERMINAL_STATE",
  "SUBSCRIPTION_CANCELLED",
  "COMPLAINT_ON_FILE",
  "NOT_IN_CATEGORY_ALLOWLIST",
  "FRAUD_RETRY_FORBIDDEN",
  "PAYMENT_METHOD_NOT_UPDATED",
  "CUSTOMER_ACTION_NOT_COMPLETED",
  "RETRY_BUDGET_EXCEEDED",
  "OUTREACH_BUDGET_EXCEEDED",
  "OPTED_OUT",
  "DEADLINE_PASSED",
  "INVALID_AGENT_OUTPUT",
  "AGENT_UNAVAILABLE",
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export const RETRY_BUDGET = 2;
export const OUTREACH_BUDGET = 3;
export const RECOVERY_DEADLINE_DAYS = 14;
export const COMMUNICATION_WINDOW = { startHour: 9, endHour: 19 } as const;
