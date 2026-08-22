-- Self-service account deletion (App Store guideline 5.1.1(v)).
--
-- Deletion cannot be a DELETE: payments, subscriptions and purchases all
-- reference users under RESTRICT, and they are financial records that must
-- outlive the account. The row therefore stays and is stripped of everything
-- identifying instead, which is what the guideline actually asks for — the
-- person is gone, the ledger is intact.
--
-- Both changes are additive and unbackfilled: every existing row keeps
-- status 'active' and a null deleted_at, which is exactly what they are.
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'deleted';

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
