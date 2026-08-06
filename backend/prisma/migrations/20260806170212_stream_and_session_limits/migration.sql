-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN     "max_sessions" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "max_streams" INTEGER NOT NULL DEFAULT 2;

-- CreateTable
CREATE TABLE "stream_leases" (
    "id" TEXT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "session_id" TEXT NOT NULL,
    "episode_id" BIGINT NOT NULL,
    "device_label" VARCHAR(100),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "stream_leases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stream_leases_user_id_last_seen_at_idx" ON "stream_leases"("user_id", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "stream_leases_session_id_key" ON "stream_leases"("session_id");

-- AddForeignKey
ALTER TABLE "stream_leases" ADD CONSTRAINT "stream_leases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
