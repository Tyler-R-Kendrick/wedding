/**
 * Next.js instrumentation hook: runs once per server start (Node runtime only).
 * Feature swarms register boot-time wiring here; keep each block independent and additive.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Swarm E: job handlers (RSVP confirmation e-mail), the seeded events/floor plans, the
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
