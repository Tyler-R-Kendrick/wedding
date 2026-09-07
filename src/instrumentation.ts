/**
 * Next.js instrumentation hook: runs once when the server starts. Installs the Better Auth
 * principal resolver so every route resolves guests/admins before the first request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // ORDER MATTERS. The Better Auth resolver must be installed first: installTestPrincipalResolver
  // wraps whatever resolver is current and falls through to it, so installed the other way round it
  // would wrap the foundation's anonymous default and no real session would resolve under test.
  await import('@/lib/auth/install');

  const { installTestPrincipalResolver } = await import('@/domain/testing/testPrincipal');
  installTestPrincipalResolver();

  // Seed once at boot, not lazily from one swarm's capability path.
  //
  // `ensureSwarmESeeded` was reachable only through `capabilities/rsvp/db.ts`, so the seed ran when
  // an RSVP or seating capability was called and at no other time. Every later level writes rows
  // that reference `guests`, and as of level 09 those are real foreign keys — so on a freshly
  // started server, assigning a transportation entitlement to a fixture guest failed with a
  // constraint violation purely because nothing had touched RSVP yet. Swarm E's own comment asked
  // the integrator to move this to the shared seed; this is that move. The function is idempotent
  // and memoized per `Db`, so the RSVP path is unchanged, and it applies its own production and
  // `SEED_TEST_FIXTURES` guards. A seeding failure must not stop the server from starting.
  try {
    const [{ getDb }, { ensureSwarmESeeded }] = await Promise.all([import('@/db/client'), import('@/domain/events/boot')]);
    await ensureSwarmESeeded(await getDb());
  } catch (err) {
    const { logger } = await import('@/lib/logger');
    logger.error({ err }, 'boot seed failed; capabilities will retry lazily');
  }
}
