CREATE TYPE "public"."tag_disabled_reason" AS ENUM('owner', 'admin', 'replaced');--> statement-breakpoint
CREATE TABLE "app_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"form_factor" "form_factor" NOT NULL,
	"allowed_types" "profile_type"[] NOT NULL,
	"quantity" integer NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tag_batches_quantity_range" CHECK ("tag_batches"."quantity" BETWEEN 1 AND 500),
	CONSTRAINT "tag_batches_label_length" CHECK (char_length("tag_batches"."label") BETWEEN 1 AND 100)
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "profile_id" uuid;--> statement-breakpoint
ALTER TABLE "scan_events" ADD COLUMN "profile_id" uuid;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "disabled_reason" "tag_disabled_reason";--> statement-breakpoint
ALTER TABLE "tag_batches" ADD CONSTRAINT "tag_batches_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_rate_limits_reset_idx" ON "app_rate_limits" USING btree ("reset_at");--> statement-breakpoint
CREATE INDEX "tag_batches_time_idx" ON "tag_batches" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_batch_id_tag_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."tag_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_profile_time_idx" ON "messages" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX "scan_events_profile_time_idx" ON "scan_events" USING btree ("profile_id","created_at");--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_disabled_has_reason" CHECK (("tags"."status" = 'disabled') = ("tags"."disabled_reason" IS NOT NULL));