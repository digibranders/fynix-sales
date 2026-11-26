CREATE TABLE "announcements" (
	"id" text PRIMARY KEY NOT NULL,
	"audience" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"created_by" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "announcements_audience_check" CHECK ("announcements"."audience" IN ('scale', 'reach', 'both'))
);--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_announcements_at" ON "announcements" USING btree ("created_at");
