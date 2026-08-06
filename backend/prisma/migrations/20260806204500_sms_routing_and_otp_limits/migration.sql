-- Cost-based SMS routing + per-number OTP rate limits.
--
-- Written by hand rather than generated so the treatment of existing rows is
-- explicit: widening phone columns and backfilling otp_codes.created_at both
-- touch live data.

-- E.164 is up to 15 digits, and the leading '+' needs a 16th character, so
-- VarChar(15) could not hold the longest legitimate international numbers.
ALTER TABLE "users" ALTER COLUMN "phone" TYPE VARCHAR(20);
ALTER TABLE "otp_codes" ALTER COLUMN "phone" TYPE VARCHAR(20);

-- Rate-limit windows count from the moment a code was sent. This was
-- previously inferred from expires_at, which skewed every window by the TTL.
-- Existing rows are backfilled from expires_at minus the 5-minute TTL those
-- codes were issued with, which reconstructs the send time exactly for all
-- historical data.
ALTER TABLE "otp_codes" ADD COLUMN "created_at" TIMESTAMP(3);
UPDATE "otp_codes" SET "created_at" = "expires_at" - INTERVAL '5 minutes' WHERE "created_at" IS NULL;
ALTER TABLE "otp_codes" ALTER COLUMN "created_at" SET NOT NULL;
ALTER TABLE "otp_codes" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "otp_codes_phone_created_at_idx" ON "otp_codes"("phone", "created_at");

-- Per-number OTP limits, admin-tunable.
ALTER TABLE "app_settings"
  ADD COLUMN "otp_cooldown_seconds" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "otp_per_hour" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "otp_per_day" INTEGER NOT NULL DEFAULT 10;

-- 'auto' routes each number by country code. Existing deployments are moved
-- onto it: the previous value was a global provider choice, and under the old
-- semantics 'africastalking' meant "send everything through AT", which cannot
-- deliver to the diaspora. 'auto' preserves AT for East African numbers, which
-- is all the old setting was actually achieving.
ALTER TABLE "app_settings" ALTER COLUMN "sms_provider" SET DEFAULT 'auto';
UPDATE "app_settings" SET "sms_provider" = 'auto' WHERE "sms_provider" = 'africastalking';
