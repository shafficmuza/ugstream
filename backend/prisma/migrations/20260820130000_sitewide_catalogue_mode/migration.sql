-- Site-wide catalogue mode. 'test' serves the test catalogue to everyone,
-- anonymous visitors included; only an Early access account sees published
-- titles. 'live' is the post-launch arrangement.
--
-- Defaults to 'test' AND backfills the singleton row, unlike the is_tester
-- default: this one is a statement about the whole site rather than about any
-- one account, and the existing settings row is the site.
ALTER TABLE "app_settings" ADD COLUMN "catalogue_mode" TEXT NOT NULL DEFAULT 'test';
