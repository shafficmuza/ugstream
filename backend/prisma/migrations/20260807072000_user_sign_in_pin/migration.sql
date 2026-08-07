-- Optional user sign-in PIN. Once set, a returning sign-in costs no SMS.
-- The failure counter and lockout are what make a four-digit secret safe to
-- accept over a public endpoint; see schema.prisma.
ALTER TABLE "users"
  ADD COLUMN "pin_hash"         TEXT,
  ADD COLUMN "pin_set_at"       TIMESTAMP(3),
  ADD COLUMN "pin_failures"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pin_locked_until" TIMESTAMP(3);
