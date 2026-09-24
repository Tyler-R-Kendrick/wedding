import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import robots from '@/app/robots';
import { AI_CRAWLERS, RESERVED_IMAGE_PATHS, rightsHeaders } from '@/lib/rights';

/* LICENSE reserves the couple's photos from AI training; these are the machine-readable signals. */

describe("the couple's rights reservation", () => {
  it('robots.txt refuses AI crawlers the whole site and every crawler the couple’s images', () => {
    const rules = [robots().rules].flat();
    const ai = rules.find((r) => Array.isArray(r.userAgent) && r.userAgent.includes('GPTBot'));
    expect(ai?.disallow).toBe('/');
    for (const bot of ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot', 'Applebot-Extended', 'Bytespider', 'meta-externalagent']) expect(AI_CRAWLERS).toContain(bot);
    const everyone = rules.find((r) => r.userAgent === '*');
    expect(everyone?.disallow).toEqual([...RESERVED_IMAGE_PATHS]);
  });

  it('headers reserve text and data mining everywhere, and the images get the stricter X-Robots-Tag last', () => {
    const rules = rightsHeaders();
    expect(rules[0]).toEqual({ source: '/:path*', headers: expect.arrayContaining([{ key: 'tdm-reservation', value: '1' }, { key: 'X-Robots-Tag', value: 'noai, noimageai' }]) });
    for (const p of RESERVED_IMAGE_PATHS) {
      const rule = rules.find((r) => r.source === `${p}:path*`);
      expect(rules.indexOf(rule!)).toBeGreaterThan(0);
      expect(rule?.headers).toEqual([{ key: 'X-Robots-Tag', value: 'noindex, noimageindex, noai, noimageai' }]);
    }
  });

  it('the TDMRep file reserves the whole origin', () => {
    const tdm = JSON.parse(readFileSync(join(process.cwd(), 'public/.well-known/tdmrep.json'), 'utf8'));
    expect(tdm).toEqual([{ location: '/*', 'tdm-reservation': 1 }]);
  });

  it('LICENSE keeps MIT to the code and reserves the photos', () => {
    const licence = readFileSync(join(process.cwd(), 'LICENSE'), 'utf8');
    expect(licence).toMatch(/MIT\s+licence below covers the source code only/);
    for (const p of RESERVED_IMAGE_PATHS) expect(licence).toContain(`public${p}`);
    expect(licence).toMatch(/train,\s+fine-tune/);
  });
});
