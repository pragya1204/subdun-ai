import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  uuid,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  planId: text("plan_id").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("INR"),
  billingCycle: text("billing_cycle").notNull().default("monthly"),
  nextBillingDate: date("next_billing_date").notNull(),
  status: text("status").notNull().default("active"), // active | paused | cancelled
  paymentMethodId: text("payment_method_id").notNull(),
  provider: text("provider").notNull().default("simulator"), // simulator | razorpay
  providerRef: text("provider_ref"), // Razorpay subscription id (sub_...) when provider = razorpay
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  customerIdx: index("subscriptions_customer_idx").on(t.customerId),
}));

export const payments = pgTable("payments", {
  id: text("id").primaryKey(),
  subscriptionId: text("subscription_id").notNull().references(() => subscriptions.id),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("INR"),
  method: text("method").notNull().default("card"),
  status: text("status").notNull(), // success | failed
  errorCode: text("error_code"),
  errorDescription: text("error_description"),
  errorSource: text("error_source"),
  errorStep: text("error_step"),
  errorReason: text("error_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  subIdx: index("payments_sub_created_idx").on(t.subscriptionId, t.createdAt),
}));

export const recoveryCases = pgTable("recovery_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  subscriptionId: text("subscription_id").notNull().references(() => subscriptions.id),
  paymentId: text("payment_id").notNull().references(() => payments.id),
  category: text("category").notNull(),
  status: text("status").notNull().default("FAILED"),
  retriesUsed: integer("retries_used").notNull().default(0),
  outreachUsed: integer("outreach_used").notNull().default(0),
  optedOut: boolean("opted_out").notNull().default(false),
  complaint: boolean("complaint").notNull().default(false),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  deadline: timestamp("deadline", { withTimezone: true }).notNull(),
  version: integer("version").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  oneOpenCasePerSub: uniqueIndex("one_open_case_per_subscription")
    .on(t.subscriptionId)
    .where(sql`${t.status} NOT IN ('RECOVERED','ESCALATED','EXHAUSTED','STOPPED')`),
  statusDeadlineIdx: index("recovery_cases_status_deadline_idx").on(t.status, t.deadline),
}));

export const recoveryActions = pgTable("recovery_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  recoveryCaseId: uuid("recovery_case_id").notNull().references(() => recoveryCases.id),
  operation: text("operation").notNull(),
  timingStrategy: text("timing_strategy"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  status: text("status").notNull().default("scheduled"), // scheduled | executed
  paymentId: text("payment_id").references(() => payments.id),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  executedAt: timestamp("executed_at", { withTimezone: true }),
}, (t) => ({
  caseIdx: index("recovery_actions_case_idx").on(t.recoveryCaseId),
}));

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  recoveryCaseId: uuid("recovery_case_id").notNull().references(() => recoveryCases.id),
  subscriptionId: text("subscription_id").notNull(),
  paymentId: text("payment_id"),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  caseCreatedIdx: index("audit_events_case_created_idx").on(t.recoveryCaseId, t.createdAt),
}));

export const outreach = pgTable("outreach", {
  id: uuid("id").primaryKey().defaultRandom(),
  recoveryCaseId: uuid("recovery_case_id").notNull().references(() => recoveryCases.id),
  kind: text("kind").notNull(), // OUTREACH | REQUEST_PAYMENT_METHOD_UPDATE | REQUEST_CUSTOMER_ACTION
  channel: text("channel").notNull(), // sms | email
  template: text("template").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("sent"), // sent | delivered | failed
  providerRef: text("provider_ref"), // Razorpay payment link id (plink_...) when provider = razorpay
  customerResponse: text("customer_response"),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
}, (t) => ({
  caseIdx: index("outreach_case_idx").on(t.recoveryCaseId),
}));

export const dueActions = pgTable("due_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  recoveryCaseId: uuid("recovery_case_id").notNull().references(() => recoveryCases.id),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  dueAtIdx: index("due_actions_due_at_idx").on(t.dueAt),
}));

export const ingestedEvents = pgTable("ingested_events", {
  eventId: text("event_id").primaryKey(),
  recoveryCaseId: uuid("recovery_case_id"),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});
