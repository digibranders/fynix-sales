ALTER TABLE "users" DROP CONSTRAINT "users_role_check";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_role_category_check";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" IN ('superadmin', 'sales', 'manager'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_category_check" CHECK (("users"."role" = 'superadmin' AND "users"."category" IS NULL) OR ("users"."role" = 'sales' AND "users"."category" IS NOT NULL) OR "users"."role" = 'manager');