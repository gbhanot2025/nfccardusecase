ALTER TABLE "tags" ADD COLUMN "uid" text;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "encoded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_uid_unique" UNIQUE("uid");--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_uid_format" CHECK ("tags"."uid" ~ '^[0-9A-F]{14}$');