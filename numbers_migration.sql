-- ══════════════════════════════════════════════════════════════════════
-- Migration: Numbers table for tracking active status & issue flags
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════════

-- 1. Create the numbers table
CREATE TABLE IF NOT EXISTS public.numbers (
  phone_number_id text PRIMARY KEY,
  "isActive" boolean DEFAULT true,
  has_issue boolean DEFAULT false,
  issue_reason text,
  label text,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- 2. Insert or update all registered accounts
INSERT INTO public.numbers (phone_number_id, "isActive", has_issue, issue_reason, label)
VALUES
  ('1296749573522436', true, false, NULL, 'أستاذ محمد إبراهيم - فيزياء'),
  ('1304612386064270', true, false, NULL, 'The Knight - Amr El-Sadek'),
  ('1173823262491619', true, false, NULL, 'Krypton - Karim Karm'),
  ('1243807105478673', true, false, NULL, 'خديوي الأحياء محمد كمال'),
  ('1057331837443942', true, false, NULL, 'أستاذ/ كُريِّم - لغة عربية'),
  ('1017485118118106', true, false, NULL, 'Lets Excel - Mohamed Yakout'),
  ('847987438407450',  true, false, NULL, 'SparkinPhysics'),
  ('1079265581929142', true, false, NULL, 'أستاذ محمد صلاح - رياضيات')
ON CONFLICT (phone_number_id) DO UPDATE
  SET label = EXCLUDED.label;

