import { z } from "zod";
import {
  CATEGORIES,
  OPERATIONS,
  TIMING_STRATEGIES,
  CASE_STATUSES,
} from "./enums.js";

export const AgentContextSchema = z.object({
  current_failure: z.object({
    category: z.enum(CATEGORIES),
    error_code: z.string(),
    amount: z.number().int(),
    failed_at: z.string(),
  }),
  recovery_history: z.object({
    retries_used: z.number().int(),
    outreach_used: z.number().int(),
    prior_actions: z.array(
      z.object({
        operation: z.enum(OPERATIONS),
        timing_strategy: z.enum(TIMING_STRATEGIES).nullable().optional(),
        reason: z.string(),
        created_at: z.string(),
      })
    ),
  }),
  subscription_history: z.object({
    successful_payments: z.number().int(),
    failed_payments: z.number().int(),
    previous_failures: z.array(
      z.object({ category: z.enum(CATEGORIES), created_at: z.string() })
    ),
  }),
  recovery_state: z.object({
    status: z.enum(CASE_STATUSES),
    days_since_failure: z.number(),
    deadline: z.string(),
  }),
  customer_signals: z.object({
    opted_out: z.boolean(),
    complaint: z.boolean(),
    payment_method_updated: z.boolean().nullable(),
    customer_action_completed: z.boolean().nullable(),
  }),
  timing_context: z.object({
    now: z.string(),
    next_billing_date: z.string().nullable(),
    days_remaining: z.number(),
  }),
  allowed_primitives: z.array(z.enum(OPERATIONS)),
  allowed_timing_strategies: z.array(z.enum(TIMING_STRATEGIES)),
});
export type AgentContext = z.infer<typeof AgentContextSchema>;

export const AgentProposalSchema = z.object({
  operation: z.enum(OPERATIONS),
  timing_strategy: z.enum(TIMING_STRATEGIES).nullable().optional(),
  reason: z.string(),
  confidence: z.number(),
});
export type AgentProposal = z.infer<typeof AgentProposalSchema>;

export const PolicyResultSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
  checks: z.record(z.string(), z.boolean()).optional(),
});
export type PolicyResult = z.infer<typeof PolicyResultSchema>;

// Provider-shaped event payloads (verbatim per spec §17.2 / Phase3 §7)
export const PaymentFailedPayloadSchema = z.object({
  payment_id: z.string(),
  subscription_id: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  method: z.string(),
  status: z.literal("failed"),
  error_code: z.string(),
  error_description: z.string(),
  error_source: z.string(),
  error_step: z.string(),
  error_reason: z.string(),
  created_at: z.string(),
});
export type PaymentFailedPayload = z.infer<typeof PaymentFailedPayloadSchema>;

export const PaymentSuccessPayloadSchema = z.object({
  payment_id: z.string(),
  subscription_id: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  method: z.string(),
  status: z.literal("success"),
  created_at: z.string(),
});
export type PaymentSuccessPayload = z.infer<typeof PaymentSuccessPayloadSchema>;

export const SubscriptionUpdatedPayloadSchema = z.object({
  subscription_id: z.string(),
  status: z.enum(["active", "paused", "cancelled"]),
  next_billing_date: z.string(),
  payment_method_id: z.string(),
});

export const PaymentMethodUpdatedPayloadSchema = z.object({
  subscription_id: z.string(),
  payment_method_id: z.string(),
  updated: z.boolean(),
});

export const CustomerActionCompletedPayloadSchema = z.object({
  subscription_id: z.string(),
  recovery_case_id: z.string(),
  completed: z.boolean(),
});

export const OutreachResultPayloadSchema = z.object({
  outreach_id: z.string(),
  status: z.enum(["delivered", "failed"]),
  customer_response: z.string().nullable(),
});

export const OptOutPayloadSchema = z.object({
  subscription_id: z.string(),
  recovery_case_id: z.string(),
});

export const ComplaintPayloadSchema = z.object({
  subscription_id: z.string(),
  recovery_case_id: z.string(),
  note: z.string(),
});

export const CancellationPayloadSchema = z.object({
  subscription_id: z.string(),
});

export const ProviderEventSchema = z.object({
  event_id: z.string(),
  event_type: z.enum([
    "payment.failed",
    "payment.success",
    "subscription.updated",
    "payment_method_updated",
    "customer_action_completed",
    "outreach.result",
    "opt_out",
    "complaint",
    "cancellation",
  ]),
  payload: z.record(z.string(), z.unknown()),
});
export type ProviderEvent = z.infer<typeof ProviderEventSchema>;

export const ScenarioConfigSchema = z.object({
  failure_code: z.string(),
  failure_behavior: z.enum(["always_fail", "fail_then_succeed", "always_succeed"]),
  customer_behavior: z.enum(["responsive", "unresponsive", "opts_out", "complains"]),
  payment_method_behavior: z.enum(["updates", "never_updates"]),
  customer_action_behavior: z.enum(["completes", "never_completes"]),
  would_native_retry_succeed: z.boolean(),
  amount: z.number().int().optional(),
  delay_ms: z.number().int().optional(),
});
export type ScenarioConfig = z.infer<typeof ScenarioConfigSchema>;

export const ManualOverrideRequestSchema = z.object({
  outcome: z.enum(["RECOVERED", "STOPPED"]),
  human_id: z.string(),
  note: z.string().optional(),
});
