-- Admin-selectable active mobile-money processor. Card stays on Stripe.
ALTER TABLE "app_settings"
  ADD COLUMN "mobile_money_provider" VARCHAR(20) NOT NULL DEFAULT 'momo';
