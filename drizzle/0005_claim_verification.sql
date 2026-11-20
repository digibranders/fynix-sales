ALTER TABLE "claims" ADD COLUMN "verified" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "verified_at" bigint;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "verified_by" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "verification_note" text;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;