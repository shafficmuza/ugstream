-- Admin-issued sign-in codes, for users who cannot receive SMS.
--
-- Nullable and unset for every existing row: those were all delivered (or
-- would have been) by SMS, so they correctly remain subject to the spend
-- limits. Only codes issued by hand from the admin UI are exempt.
ALTER TABLE "otp_codes" ADD COLUMN "issued_by_admin_id" BIGINT;
