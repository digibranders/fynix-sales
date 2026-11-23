-- Stages are now: New, Didnt Pick, Follow Up, Meeting, Won (Closed), Lost, Invalid Number, Invalid Email.
-- Old Contacted, Interested and Negotiation leads become Follow Up. Won, Lost, Meeting and New are unchanged.
UPDATE "claims" SET "status" = 'Follow Up' WHERE "status" IN ('Contacted', 'Interested', 'Negotiation');--> statement-breakpoint
UPDATE "claim_events" SET "status" = 'Follow Up' WHERE "status" IN ('Contacted', 'Interested', 'Negotiation');--> statement-breakpoint
UPDATE "notes" SET "stage" = 'Follow Up' WHERE "stage" IN ('Contacted', 'Interested', 'Negotiation');--> statement-breakpoint
UPDATE "notes" SET "text" = REPLACE(REPLACE(REPLACE("text", 'Contacted', 'Follow Up'), 'Interested', 'Follow Up'), 'Negotiation', 'Follow Up') WHERE "system" = 1 AND "text" LIKE 'Stage changed to %';--> statement-breakpoint
UPDATE "claims" SET "next_follow_up" = NULL WHERE "status" <> 'Follow Up';
