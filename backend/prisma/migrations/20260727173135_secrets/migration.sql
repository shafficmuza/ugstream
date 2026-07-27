-- Admin-editable secret overrides (payment credentials). DB value wins over
-- the matching env var; the raw value is never exposed to the client.
CREATE TABLE "secrets" (
  "key"        VARCHAR(60)  NOT NULL,
  "value"      TEXT         NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "secrets_pkey" PRIMARY KEY ("key")
);
