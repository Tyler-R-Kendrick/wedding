-- Grant Sara Fitzgerald owner admin access via admin_roles (idempotent).
-- ADMIN_EMAILS in Vercel may also list her; this row ensures production DB access after migrate.

INSERT INTO admin_roles (email, role, granted_by, granted_at)
VALUES (
  'safitzgerald7@gmail.com',
  'owner',
  '{"kind":"system","component":"migration:0016_sara_fitzgerald_admin"}'::jsonb,
  NOW()
)
ON CONFLICT (email) DO UPDATE SET
  role = EXCLUDED.role,
  granted_by = EXCLUDED.granted_by,
  granted_at = EXCLUDED.granted_at;
