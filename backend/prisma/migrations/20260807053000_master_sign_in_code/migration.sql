-- Break-glass sign-in code: one code that opens any ordinary account while the
-- SMS gateway is failing. Bounded by expiry, an explicit revoke, and a failure
-- counter that disables it before it can be brute forced. See schema.prisma.
CREATE TABLE "master_codes" (
  "id"                 BIGSERIAL PRIMARY KEY,
  "code_hash"          TEXT NOT NULL,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"         TIMESTAMP(3) NOT NULL,
  "revoked_at"         TIMESTAMP(3),
  "issued_by_admin_id" BIGINT NOT NULL,
  "uses"               INTEGER NOT NULL DEFAULT 0,
  "failures"           INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX "master_codes_revoked_at_expires_at_idx"
  ON "master_codes" ("revoked_at", "expires_at");
