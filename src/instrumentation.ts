/**
 * Next.js instrumentation hook: runs once when a server process starts, before its first request.
 * It refuses hosted AI models and installs the principal resolver, so every route resolves guests
 * and admins the same way.
 *
 * "A server process" is the catch. On Vercel every route is its own function, and the proxy is
 * another: a cold request starts two processes, and each ran this hook in full. Measured on
 * production, that was 1.2 to 1.6 seconds loading the sign-in libraries and 0.2 to 0.8 connecting
 * to the database, in the proxy (which never resolves anyone and never touches the database) and
 * again in the page. So in production nothing heavy is loaded here: the resolver is installed as a
 * small stand-in that loads the real one on the first request that carries a cookie, and the
 * database connects when something first reads it. Development and test keep the eager start,
 * where the boot seed and the test resolver depend on it and nobody waits on a cold start.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // How long this hook took and where. One line per server start.
  const boot = { librariesMs: 0, databaseMs: 0, mode: 'eager' as 'eager' | 'lazy' };
  const hookStarted = performance.now();

  // Before anything can call a model: a model named by a string must never reach Vercel's AI Gateway.
  const { refuseHostedModels } = await import('@/lib/ai/no-hosted-models');
  refuseHostedModels();

  const { startsLazily } = await import('@/lib/boot-mode');
  if (startsLazily(process.env)) {
    boot.mode = 'lazy';
    const { ANONYMOUS, setPrincipalResolver } = await import('@/lib/principal');
    setPrincipalResolver({
      async resolve(request) {
        // The real resolver's own first rule (src/lib/auth/resolver.ts): no cookie, nobody. Test
        // injection, its only earlier rule, cannot apply here: it is off outside NODE_ENV=test.
        if (!request.headers.get('cookie')) return ANONYMOUS;
        const { betterAuthPrincipalResolver } = await import('@/lib/auth/resolver');
        return betterAuthPrincipalResolver.resolve(request);
      },
    });
    // The travel pages' location suggestion, registered the same way: loaded when first asked for.
    (globalThis as unknown as { __weddingTravelLocationResolver?: LocationSuggestionResolver }).__weddingTravelLocationResolver = async (db, guestId) => {
      const { invitationLocationSuggestion } = await import('@/domain/travel/invitation-location');
      return invitationLocationSuggestion(db, guestId);
    };
    boot.librariesMs = Math.round(performance.now() - hookStarted);
    const { logger } = await import('@/lib/logger');
    logger.info({ boot }, 'server started');
    return;
  }

  // ORDER MATTERS. The Better Auth resolver must be installed first: installTestPrincipalResolver
  // wraps whatever resolver is current and falls through to it, so installed the other way round it
  // would wrap the foundation's anonymous default and no real session would resolve under test.
  await import('@/lib/auth/install');

  // Also the guard that refuses to start a production host with TEST_AUTH_SECRET set.
  const { installTestPrincipalResolver } = await import('@/domain/testing/testPrincipal');
  installTestPrincipalResolver();
  boot.librariesMs = Math.round(performance.now() - hookStarted);

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
    const [{ getDb }, { ensureSwarmESeeded }, { setLocationSuggestionResolver }, { invitationLocationSuggestion }] = await Promise.all([
      import('@/db/client'),
      import('@/domain/events/boot'),
      import('@/domain/travel/profile'),
      import('@/domain/travel/invitation-location'),
    ]);
    setLocationSuggestionResolver((db, guestId) => invitationLocationSuggestion(db, guestId));
    await ensureSwarmESeeded(await getDb());
  } catch (err) {
    const { logger } = await import('@/lib/logger');
    logger.error({ err }, 'boot seed failed; capabilities will retry lazily');
  }
  boot.databaseMs = Math.round(performance.now() - hookStarted) - boot.librariesMs;
  const { logger } = await import('@/lib/logger');
  logger.info({ boot }, 'server started');
}

type LocationSuggestionResolver = import('@/domain/travel/profile').LocationSuggestionResolver;
