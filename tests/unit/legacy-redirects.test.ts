import nextConfig from '../../next.config';
import { describe, expect, it } from 'vitest';

describe('legacy guest routes', () => {
  it('permanently redirects old paths to their current routes', async () => {
    const rules = await nextConfig.redirects!();
    const bySource = Object.fromEntries(rules.map((r) => [r.source, r]));
    expect(bySource['/faq']).toMatchObject({ destination: '/ask-us', permanent: true });
    expect(bySource['/things-to-do']).toMatchObject({ destination: '/share-an-adventure', permanent: true });
    expect(bySource['/wedding-day']).toMatchObject({ destination: '/the-wedding', permanent: true });
    expect(bySource['/registry']).toMatchObject({ destination: '/gifts', permanent: true });
  });
});
