ALTER TABLE "outreach" ADD COLUMN "provider_ref" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider" text DEFAULT 'simulator' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider_ref" text;