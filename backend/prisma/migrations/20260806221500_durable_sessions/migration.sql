-- Durable sessions: indexed refresh-token lookup + a grace window on rotation.
--
-- Existing rows keep refresh_lookup NULL on purpose. Their tokens were issued
-- in the old opaque format and are still verified by scan, so everyone who is
-- currently signed in stays signed in and migrates to the new format on their
-- next refresh. Backfilling would mean inventing a lookup half that no client
-- holds, which would sign every one of them out — the exact failure this
-- migration exists to fix.
ALTER TABLE "sessions"
  ADD COLUMN "refresh_lookup" TEXT,
  ADD COLUMN "prev_refresh_hash" TEXT,
  ADD COLUMN "prev_refresh_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "sessions_refresh_lookup_key" ON "sessions"("refresh_lookup");
