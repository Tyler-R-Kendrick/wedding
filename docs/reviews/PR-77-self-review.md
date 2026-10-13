# PR #77 self-review — Supabase RLS lockdown

## Scope

- Confirmed `wedding-db` (`txwdrxhecebbolomztte`) is this repo's schema: all tables live in `src/db/migrations/` and deploy via `migrate-on-deploy.mjs`.
- Migration `0014_supabase_rls_lockdown` enables RLS on every `public` table and revokes `anon` / `authenticated` table and sequence grants when those roles exist.
- No app query changes: the site uses Drizzle over `DATABASE_URL`, not the Supabase JS client.

## Risks considered

| Risk | Mitigation |
| --- | --- |
| App loses DB access after RLS | Server connects as `postgres` / pooler role with `BYPASSRLS`; migration does not `FORCE ROW LEVEL SECURITY`. |
| PGlite dev/tests break on `REVOKE` | Dynamic SQL skips revokes when `anon` / `authenticated` roles are absent. |
| Future migrations re-grant API access | `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` revokes from API roles on new tables. |
| Guest-scoped PostgREST policies | Not applicable: Better Auth is not Supabase Auth; API surface is deny-all. |

## Verification

- Integration: `migrations.test.ts` (RLS on all tables), `rsvp.test.ts`, `admin-identity.test.ts`, `events-admin.test.ts`
- CI: design-quality (typecheck through Playwright smoke) green on `cursor/supabase-rls-lockdown-aaa2`

## Follow-up (human)

- After merge and production deploy, re-run the [Supabase security advisor](https://supabase.com/dashboard/project/txwdrxhecebbolomztte/advisors/security) to confirm lint 0013 / 0023 are cleared.
