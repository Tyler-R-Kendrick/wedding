import nextConfig from '../../next.config';
import { describe, expect, it } from 'vitest';

describe('legacy guest routes', () => {
  it('permanently redirects old paths to their current routes', async () => {
    const rules = await nextConfig.redirects!();
    const bySource = Object.fromEntries(rules.map((r) => [r.source, r]));
    expect(bySource['/faq']).toMatchObject({ destination: '/guests/ask-us', permanent: true });
    expect(bySource['/registry']).toMatchObject({ destination: '/gifts', permanent: true });
    // The pages folded into the guest portal: each old address leads to where its content went.
    expect(bySource['/your-weekend']).toMatchObject({ destination: '/guests', permanent: true });
    expect(bySource['/the-wedding']).toMatchObject({ destination: '/guests', permanent: true });
    expect(bySource['/travel']).toMatchObject({ destination: '/guests/travel', permanent: true });
    // The Things to Do list became the planner on Your Trip; both of its old addresses lead there.
    expect(bySource['/guests/things-to-do']).toMatchObject({ destination: '/guests/travel#plan', permanent: true });
    expect(bySource['/share-an-adventure']).toMatchObject({ destination: '/guests/travel#plan', permanent: true });
    expect(bySource['/share-an-adventure/:slug']).toMatchObject({ destination: '/guests/things-to-do/:slug', permanent: true });
    expect(bySource['/ask-us']).toMatchObject({ destination: '/guests/ask-us', permanent: true });
    // Aliases of aliases were dropped rather than chained: these are 404s now.
    for (const gone of ['/things-to-do', '/wedding-day', '/explore-caa', '/explore-caa/:slug']) expect(bySource[gone], gone).toBeUndefined();
    // No alias lands on a page that was removed, and none sends a reader to a public copy of a guest page.
    const sources = new Set(rules.map((r) => r.source));
    for (const r of rules) expect(sources.has(r.destination), `${r.source} → ${r.destination} is itself redirected`).toBe(false);
    // The Duffel webhook lives under /travel and must not be swallowed by the /travel alias.
    expect(rules.some((r) => r.source.startsWith('/travel/') || r.source === '/travel/:path*')).toBe(false);
    expect(bySource['/our-adventures/alinea-2026-02-13-a']).toMatchObject({ destination: '/our-adventures/alinea-2026-02-13', permanent: true });
    expect(bySource['/our-adventures/noma-2025-06-24']).toMatchObject({ destination: '/our-adventures/copenhagen-denmark-2025', permanent: true });
  });
});
