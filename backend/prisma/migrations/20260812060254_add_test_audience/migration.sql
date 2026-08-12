-- AlterTable
ALTER TABLE "titles" ADD COLUMN     "is_test" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_tester" BOOLEAN NOT NULL DEFAULT false;
