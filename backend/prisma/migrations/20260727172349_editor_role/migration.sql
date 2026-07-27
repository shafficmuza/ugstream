-- Add an 'editor' staff role between 'user' and 'admin'. Editors manage
-- content (add/edit titles, upload, add genres/kinds, publish) but cannot
-- delete anything or touch critical sections (settings, payments, plans, users).
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'editor' BEFORE 'admin';
