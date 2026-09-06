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
}
