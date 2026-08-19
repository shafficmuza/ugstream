-- Admin-configurable support contacts for the app's "Contact us" section.
--
-- Nullable with no backfill: an empty field means "we don't publish this
-- channel", and the client hides that row rather than showing a blank one.

-- support_whatsapp is separate from the existing support_phone because the
-- number people call is not always the number on WhatsApp. Stored in E.164
-- so the app can build a wa.me link from it directly.
ALTER TABLE "app_settings" ADD COLUMN     "support_whatsapp" TEXT,
ADD COLUMN     "support_hours" TEXT;
