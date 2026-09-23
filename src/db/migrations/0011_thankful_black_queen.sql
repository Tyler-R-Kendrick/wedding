ALTER TABLE "rsvp_responses" ADD COLUMN "plus_one_answered_at" timestamp with time zone;--> statement-breakpoint
-- Every accepted answer on file came through the single RSVP form, which always asked the plus-one
-- question wherever the invitation included one. Those rows have answered it; without this they
-- would read "not answered" the day plus-ones became a part of their own.
UPDATE "rsvp_responses" SET "plus_one_answered_at" = "updated_at" WHERE "status" = 'accepted';
