-- Convert Title.kind from the TitleKind enum to a plain VARCHAR so admins can
-- add their own kinds at runtime, and introduce a managed `kinds` lookup table.

-- 1. Column: enum -> varchar(60). USING casts existing 'movie'/'series' values.
ALTER TABLE "titles"
  ALTER COLUMN "kind" DROP DEFAULT,
  ALTER COLUMN "kind" TYPE VARCHAR(60) USING ("kind"::text),
  ALTER COLUMN "kind" SET DEFAULT 'movie';

-- 2. The enum type is now unused.
DROP TYPE "TitleKind";

-- 3. Managed kinds table.
CREATE TABLE "kinds" (
  "id"         SERIAL       NOT NULL,
  "name"       VARCHAR(50)  NOT NULL,
  "slug"       VARCHAR(60)  NOT NULL,
  "sort_order" INTEGER      NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kinds_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "kinds_name_key" ON "kinds"("name");
CREATE UNIQUE INDEX "kinds_slug_key" ON "kinds"("slug");

-- 4. Seed the two kinds that used to be hardcoded.
INSERT INTO "kinds" ("name", "slug", "sort_order") VALUES
  ('Movie', 'movie', 0),
  ('Series', 'series', 1);
