import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '@/contracts/principal';

vi.mock('@/components/local-models/LocalModelKeeper', () => ({ LocalModelKeeper: () => null }));
const { GuestModelKeeper } = await import('@/components/local-models/GuestModelKeeper');
const { LocalModelKeeper } = await import('@/components/local-models/LocalModelKeeper');

describe('the on-device models download for signed-in guests only', () => {
  it('mounts the keeper for a guest and for nobody else', () => {
    const guest = { kind: 'guest', guestId: 'g1', householdId: 'h1' } as unknown as Principal;
    expect(GuestModelKeeper({ principal: guest })?.type).toBe(LocalModelKeeper);
    expect(GuestModelKeeper({ principal: { kind: 'anonymous' } })).toBeNull();
    expect(GuestModelKeeper({ principal: { kind: 'admin' } as unknown as Principal })).toBeNull();
  });

  it('is not mounted by the root layout, which every visitor gets', () => {
    expect(readFileSync('src/app/layout.tsx', 'utf8')).not.toMatch(/ModelKeeper/);
  });

  it('is mounted by the guest layout and by each guest page that brings its own Shell', () => {
    for (const file of ['src/app/(guest)/layout.tsx', 'src/app/(guest)/guests/travel/page.tsx', 'src/app/(guest)/guests/ask-us/page.tsx', 'src/app/(guest)/guests/things-to-do/[slug]/page.tsx']) {
      expect(readFileSync(file, 'utf8'), file).toMatch(/<GuestModelKeeper principal=\{principal\} \/>/);
    }
  });
});
