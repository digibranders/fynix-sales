CREATE TABLE "activity" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"at" bigint NOT NULL,
	"category" text,
	"text" text NOT NULL,
	"sub" text DEFAULT '' NOT NULL,
	CONSTRAINT "activity_category_check" CHECK ("activity"."category" IN ('scale', 'reach'))
);
--> statement-breakpoint
CREATE TABLE "claim_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "claim_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"claim_id" text NOT NULL,
	"status" text NOT NULL,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"status" text DEFAULT 'New' NOT NULL,
	"next_follow_up" text,
	"last_activity_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "claims_lead_workspace" UNIQUE("lead_id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "kpi_targets" (
	"category" text NOT NULL,
	"metric" text NOT NULL,
	"value" integer NOT NULL,
	CONSTRAINT "kpi_targets_category_metric_pk" PRIMARY KEY("category","metric"),
	CONSTRAINT "kpi_category_check" CHECK ("kpi_targets"."category" IN ('scale', 'reach')),
	CONSTRAINT "kpi_metric_check" CHECK ("kpi_targets"."metric" IN ('contacted', 'meetings', 'won')),
	CONSTRAINT "kpi_value_check" CHECK ("kpi_targets"."value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"list_id" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"google_category" text DEFAULT '' NOT NULL,
	"area" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"emails" text DEFAULT '[]' NOT NULL,
	"whatsapp" text DEFAULT '' NOT NULL,
	"hours" text DEFAULT '[]' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"job_title" text DEFAULT '' NOT NULL,
	"personal_number" text DEFAULT '' NOT NULL,
	"keywords" text DEFAULT '' NOT NULL,
	"linkedin_url" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	CONSTRAINT "leads_list_external" UNIQUE("list_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"file_name" text NOT NULL,
	"created_by" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "lists_category_check" CHECK ("lists"."category" IN ('scale', 'reach'))
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"claim_id" text NOT NULL,
	"author_id" text,
	"system" integer DEFAULT 0 NOT NULL,
	"stage" text NOT NULL,
	"text" text NOT NULL,
	"at" bigint NOT NULL,
	"edited_at" bigint
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"sub" text NOT NULL,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_reads" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	CONSTRAINT "notification_reads_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"category" text,
	"active" integer DEFAULT 1 NOT NULL,
	"must_change_password" integer DEFAULT 0 NOT NULL,
	"last_login_at" bigint,
	"created_at" bigint NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_role_check" CHECK ("users"."role" IN ('superadmin', 'sales')),
	CONSTRAINT "users_category_check" CHECK ("users"."category" IN ('scale', 'reach')),
	CONSTRAINT "users_role_category_check" CHECK (("users"."role" = 'superadmin' AND "users"."category" IS NULL) OR ("users"."role" = 'sales' AND "users"."category" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "workspace_lists" (
	"workspace_id" text NOT NULL,
	"list_id" text NOT NULL,
	CONSTRAINT "workspace_lists_workspace_id_list_id_pk" PRIMARY KEY("workspace_id","list_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"color" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "workspaces_category_key" UNIQUE("category","key"),
	CONSTRAINT "workspaces_category_check" CHECK ("workspaces"."category" IN ('scale', 'reach'))
);
--> statement-breakpoint
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_lists" ADD CONSTRAINT "workspace_lists_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_lists" ADD CONSTRAINT "workspace_lists_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_activity_at" ON "activity" USING btree ("at");--> statement-breakpoint
CREATE INDEX "idx_events_claim" ON "claim_events" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "idx_claims_owner" ON "claims" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_claims_workspace" ON "claims" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_leads_list" ON "leads" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "idx_notes_claim" ON "notes" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "idx_notices_user" ON "notices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_user" ON "sessions" USING btree ("user_id");