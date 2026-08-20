-- New accounts join the test catalogue until an admin moves them off it.
--
-- Only the DEFAULT changes, deliberately: existing rows keep the value they
-- already have, so nobody watching today has their catalogue swapped out from
-- under them. A backfill here would do exactly that.
ALTER TABLE "users" ALTER COLUMN "is_tester" SET DEFAULT true;
