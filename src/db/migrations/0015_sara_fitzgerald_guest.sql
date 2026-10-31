-- Idempotent production guest: Sara Fitzgerald (bride) can sign in as a guest via email OTP.
-- Stable ids from src/db/seed/bride-guest.ts (seedId). Not an administrator row.

INSERT INTO households (id, name, manager_guest_id, created_at, updated_at)
VALUES (
  '01SDBRDEHH0000000000000000',
  'Sara Fitzgerald',
  NULL,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  updated_at = NOW();
--> statement-breakpoint
INSERT INTO guests (
  id,
  household_id,
  first_name,
  last_name,
  email,
  kind,
  is_minor,
  is_named,
  plus_one_of_guest_id,
  managed_by_guest_id,
  merged_into_guest_id,
  notes,
  created_at,
  updated_at
)
VALUES (
  '01SDBRDEGST000000000000000',
  '01SDBRDEHH0000000000000000',
  'Sara',
  'Fitzgerald',
  'safitzgerald7@gmail.com',
  'adult',
  false,
  true,
  NULL,
  NULL,
  NULL,
  NULL,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  household_id = EXCLUDED.household_id,
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  email = EXCLUDED.email,
  kind = EXCLUDED.kind,
  is_minor = EXCLUDED.is_minor,
  is_named = EXCLUDED.is_named,
  updated_at = NOW();
--> statement-breakpoint
UPDATE households
SET manager_guest_id = '01SDBRDEGST000000000000000',
    updated_at = NOW()
WHERE id = '01SDBRDEHH0000000000000000';
