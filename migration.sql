-- ══════════════════════════════════════════════════════════════════════
-- Migration: Add phone_number_id to messages table
-- Run this in Supabase SQL Editor BEFORE deploying the updated code
-- ══════════════════════════════════════════════════════════════════════

-- 1. Add the column (nullable so existing rows aren't affected)
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS phone_number_id text;

-- 2. Index for fast filtering by phone_number_id (all dashboard queries use this)
CREATE INDEX IF NOT EXISTS idx_messages_phone_number_id
  ON public.messages (phone_number_id);

-- 3. Composite index for the main chat-loading query pattern:
--    WHERE phone_number_id = ? ORDER BY timestamp DESC
CREATE INDEX IF NOT EXISTS idx_messages_pnid_timestamp
  ON public.messages (phone_number_id, timestamp DESC);

-- 4. Composite index for per-chat message loading:
--    WHERE phone_number_id = ? AND contact_phone = ? ORDER BY timestamp DESC
CREATE INDEX IF NOT EXISTS idx_messages_pnid_contact_timestamp
  ON public.messages (phone_number_id, contact_phone, timestamp DESC);

-- 5. (Optional) Backfill existing rows with your current phone_number_id
--    Uncomment and replace YOUR_PHONE_NUMBER_ID with your actual ID:
--
-- UPDATE public.messages
--   SET phone_number_id = 'YOUR_PHONE_NUMBER_ID'
--   WHERE phone_number_id IS NULL;

-- 6. Enable Realtime filtering on the new column
--    (Supabase Realtime needs this to support filter: phone_number_id=eq.xxx)
--    Go to Supabase Dashboard → Database → Replication → messages table
--    and ensure the table has Realtime enabled. The filter will work
--    automatically once the column exists.
