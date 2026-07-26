-- AlterTable
ALTER TABLE "episodes" ADD COLUMN     "r2_prefix" VARCHAR(120),
ADD COLUMN     "video_provider" VARCHAR(20) NOT NULL DEFAULT 'cloudflare';
