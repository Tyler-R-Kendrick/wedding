-- Supabase Data API hardening (issue #76).
-- The Next.js app talks to Postgres through DATABASE_URL (postgres / service_role), not PostgREST.
-- Better Auth lives in our tables, not auth.users, so anon/authenticated JWTs must not read the schema.
-- Enable RLS everywhere (default deny with no policies) and revoke API role grants on every public object.

DO $$
DECLARE
  tbl record;
  seq record;
  has_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_auth boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  FOR tbl IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl.tablename);
    IF has_anon THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', tbl.tablename);
    END IF;
    IF has_auth THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', tbl.tablename);
    END IF;
  END LOOP;

  FOR seq IN
    SELECT c.relname AS seqname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
  LOOP
    IF has_anon THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM anon', seq.seqname);
    END IF;
    IF has_auth THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM authenticated', seq.seqname);
    END IF;
  END LOOP;

  IF has_anon OR has_auth THEN
    -- Drizzle migrations run as postgres; stop future tables from inheriting Supabase API grants.
    IF has_anon THEN
      EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
      EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon';
    END IF;
    IF has_auth THEN
      EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated';
      EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated';
    END IF;
  END IF;
END $$;
