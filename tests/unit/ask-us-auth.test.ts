import { describe, expect, it } from 'vitest';
import { getFaq } from '@/capabilities/get_faq';
import { invoke } from '@/capabilities';
import { createCapabilityContext } from '@/capabilities/context';
import nextConfig from '../../next.config';

describe('/faq legacy redirect', () => {
  it('still points at Ask Us', async () => {
    const rules = await nextConfig.redirects!();
    const bySource = Object.fromEntries(rules.map((r) => [r.source, r]));
    expect(bySource['/faq']).toMatchObject({ destination: '/ask-us', permanent: true });
  });
});

describe('Ask Us API authorization', () => {
  it('returns 401 for get_faq without a session', async () => {
    // Exercises the HTTP door the browser uses; anonymous invoke is covered in integration/ask-us-auth.test.ts.
    const ctx = await createCapabilityContext({ principal: { kind: 'anonymous' }, requestId: 'unit-ask-401', surface: 'ui' });
    const direct = await invoke(getFaq, ctx, {});
    expect(!direct.ok && direct.error.code).toBe('unauthenticated');
  });
});
