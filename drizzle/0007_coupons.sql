CREATE TABLE "coupons" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"user_id" text NOT NULL,
	"bb_coupon_id" text NOT NULL,
	"currency" text NOT NULL,
	"discount_kind" text NOT NULL,
	"discount_value" text NOT NULL,
	"discount_months" integer,
	"expires_at" text,
	"max_redemptions" integer,
	"created_at" bigint NOT NULL,
	CONSTRAINT "coupons_code_unique" UNIQUE("code"),
	CONSTRAINT "coupons_kind_check" CHECK ("coupons"."discount_kind" IN ('percent', 'amount'))
);--> statement-breakpoint
CREATE TABLE "coupon_payments" (
	"event_id" text PRIMARY KEY NOT NULL,
	"coupon_id" text NOT NULL,
	"business_id" text NOT NULL,
	"client_name" text NOT NULL,
	"client_email" text NOT NULL,
	"payment_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"paid_at" bigint NOT NULL,
	"received_at" bigint NOT NULL
);--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_payments" ADD CONSTRAINT "coupon_payments_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_coupons_user" ON "coupons" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_coupon_payments_coupon" ON "coupon_payments" USING btree ("coupon_id");
