import type { Category, Operation, TimingStrategy } from "@recovery/shared";

export const CATEGORY_POLICY: Record<Category, { primitives: Operation[]; timing: TimingStrategy[] }> = {
  SOFT_BALANCE: { primitives: ["WAIT", "RETRY_PAYMENT", "OUTREACH"], timing: ["NEXT_PAYDAY"] },
  SOFT_LIMIT: { primitives: ["WAIT", "RETRY_PAYMENT", "OUTREACH"], timing: ["WAIT_24H"] },
  SOFT_TRANSIENT: { primitives: ["WAIT", "RETRY_PAYMENT", "OUTREACH"], timing: ["WAIT_6H", "WAIT_24H", "WAIT_72H"] },
  CUSTOMER_ACTION: { primitives: ["OUTREACH", "REQUEST_CUSTOMER_ACTION", "WAIT", "RETRY_PAYMENT"], timing: ["IMMEDIATE", "WAIT_72H"] },
  PAYMENT_METHOD_INVALID: { primitives: ["OUTREACH", "REQUEST_PAYMENT_METHOD_UPDATE", "WAIT", "RETRY_PAYMENT"], timing: ["IMMEDIATE", "WAIT_72H"] },
  FRAUD_RISK: { primitives: [], timing: [] },
  UNKNOWN_DECLINE: { primitives: ["OUTREACH"], timing: ["WAIT_72H"] },
};

/** ESCALATE/STOP are appended to every category's allow-list at lookup time. */
export function allowedPrimitives(category: Category): Operation[] {
  return [...CATEGORY_POLICY[category].primitives, "ESCALATE", "STOP"];
}

export function allowedTimingStrategies(category: Category): TimingStrategy[] {
  return CATEGORY_POLICY[category].timing;
}
