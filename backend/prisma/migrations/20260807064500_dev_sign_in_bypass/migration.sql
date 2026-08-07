-- Development sign-in bypass: a fixed code standing in for the SMS one on a
-- named handful of numbers. Off by default; see schema.prisma for why it is
-- scoped to explicit numbers rather than to a role.
ALTER TABLE "app_settings"
  ADD COLUMN "dev_bypass_enabled"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dev_bypass_code_hash" TEXT,
  ADD COLUMN "dev_bypass_phones"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "dev_bypass_failures"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "dev_bypass_set_at"    TIMESTAMP(3);
