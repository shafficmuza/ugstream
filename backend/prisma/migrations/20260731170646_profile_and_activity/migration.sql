-- User profile fields (email/address optional; displayName already exists).
ALTER TABLE "users" ADD COLUMN "email" VARCHAR(120);
ALTER TABLE "users" ADD COLUMN "address" VARCHAR(200);

-- Content activity/audit log: who uploaded/created what, when.
CREATE TABLE "activity_logs" (
  "id"         BIGSERIAL    NOT NULL,
  "user_id"    BIGINT       NOT NULL,
  "action"     VARCHAR(40)  NOT NULL,
  "title_id"   BIGINT,
  "summary"    VARCHAR(300) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs"("created_at");
