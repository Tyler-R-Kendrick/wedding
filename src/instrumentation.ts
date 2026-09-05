/**
 * Next.js instrumentation hook: runs once per server start (Node runtime only).
 * Feature levels register boot-time wiring here; keep each block independent and additive.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // ORDER MATTERS. Level 06's Better Auth resolver must be installed BEFORE the test-only
  // injector below, because `installTestPrincipalResolver` wraps whatever resolver is current
  // and falls through to it. Installed the other way round, the injector would wrap the
  // foundation's anonymous default and no real session would ever resolve under NODE_ENV=test.
  await import('@/lib/auth/install');

  // Level 07: job handlers (RSVP confirmation e-mail), the seeded events/floor plans, the
  // test-only principal injector, and test fixtures (NODE_ENV=test + SEED_TEST_FIXTURES=1 only).
  const [{ registerRsvpJobs }, { installTestPrincipalResolver }, { bootSwarmE }] = await Promise.all([
    import('@/domain/rsvp/email'),
    import('@/domain/testing/testPrincipal'),
    import('@/domain/events/boot'),
  ]);
  registerRsvpJobs();
  installTestPrincipalResolver();
  await bootSwarmE();
}
