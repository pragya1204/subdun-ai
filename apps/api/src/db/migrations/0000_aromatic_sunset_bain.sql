CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recovery_case_id" uuid NOT NULL,
	"subscription_id" text NOT NULL,
	"payment_id" text,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "due_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recovery_case_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ingested_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"recovery_case_id" uuid,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outreach" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recovery_case_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"template" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"customer_response" text,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"method" text DEFAULT 'card' NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"error_description" text,
	"error_source" text,
	"error_step" text,
	"error_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recovery_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recovery_case_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"timing_strategy" text,
	"scheduled_at" timestamp with time zone,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"payment_id" text,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recovery_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'FAILED' NOT NULL,
	"retries_used" integer DEFAULT 0 NOT NULL,
	"outreach_used" integer DEFAULT 0 NOT NULL,
	"opted_out" boolean DEFAULT false NOT NULL,
	"complaint" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"billing_cycle" text DEFAULT 'monthly' NOT NULL,
	"next_billing_date" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"payment_method_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_recovery_case_id_recovery_cases_id_fk" FOREIGN KEY ("recovery_case_id") REFERENCES "public"."recovery_cases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "due_actions" ADD CONSTRAINT "due_actions_recovery_case_id_recovery_cases_id_fk" FOREIGN KEY ("recovery_case_id") REFERENCES "public"."recovery_cases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach" ADD CONSTRAINT "outreach_recovery_case_id_recovery_cases_id_fk" FOREIGN KEY ("recovery_case_id") REFERENCES "public"."recovery_cases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recovery_actions" ADD CONSTRAINT "recovery_actions_recovery_case_id_recovery_cases_id_fk" FOREIGN KEY ("recovery_case_id") REFERENCES "public"."recovery_cases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recovery_actions" ADD CONSTRAINT "recovery_actions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recovery_cases" ADD CONSTRAINT "recovery_cases_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recovery_cases" ADD CONSTRAINT "recovery_cases_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_case_created_idx" ON "audit_events" USING btree ("recovery_case_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "due_actions_due_at_idx" ON "due_actions" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_case_idx" ON "outreach" USING btree ("recovery_case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_sub_created_idx" ON "payments" USING btree ("subscription_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_actions_case_idx" ON "recovery_actions" USING btree ("recovery_case_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "one_open_case_per_subscription" ON "recovery_cases" USING btree ("subscription_id") WHERE "recovery_cases"."status" NOT IN ('RECOVERED','ESCALATED','EXHAUSTED','STOPPED');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_cases_status_deadline_idx" ON "recovery_cases" USING btree ("status","deadline");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_customer_idx" ON "subscriptions" USING btree ("customer_id");