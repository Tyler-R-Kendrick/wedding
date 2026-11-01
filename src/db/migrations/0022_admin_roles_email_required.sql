-- Require a normalized, valid email for every console administrator row.
DO $$
DECLARE
  bad_email text;
BEGIN
  SELECT email INTO bad_email
  FROM admin_roles
  WHERE email IS NULL
     OR btrim(email) = ''
     OR email <> lower(btrim(email))
     OR email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     OR length(email) > 254
  LIMIT 1;

  IF bad_email IS NOT NULL THEN
    RAISE EXCEPTION 'admin_roles row % has an invalid or missing email; fix it before migrating', bad_email;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE admin_roles
  ADD CONSTRAINT admin_roles_email_shape_chk
  CHECK (
    email IS NOT NULL
    AND btrim(email) <> ''
    AND email = lower(btrim(email))
    AND email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
    AND length(email) <= 254
  );
