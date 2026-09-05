/**
 * Next.js instrumentation hook: runs once when the server starts. Installs the Better Auth
 * principal resolver so every route resolves guests/admins before the first request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('@/lib/auth/install');
  }
}
