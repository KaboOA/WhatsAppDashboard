-- 1. Create the numbers table
CREATE TABLE
IF NOT EXISTS public.numbers
(
  phone_number_id text PRIMARY KEY,
  "isActive" boolean DEFAULT true
);

-- 2. Insert existing numbers
-- (Replace these with your actual phone_number_ids)
INSERT INTO public.numbers
  (phone_number_id, "isActive")
VALUES
  ('1057331837443942', true);
INSERT INTO public.numbers
  (phone_number_id, "isActive")
VALUES
  ('1017485118118106', true);
