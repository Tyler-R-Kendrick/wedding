import { describe, expect, it, vi } from 'vitest';
import { lazyProvider } from '@/providers/lazy';

class Storage {
  name = 'real';
  greet() {
    return `hi from ${this.name}`;
  }
}

describe('lazyProvider', () => {
  it('builds nothing until used, then builds once', () => {
    const build = vi.fn(() => new Storage());
    const p = lazyProvider(build);
    expect(build).not.toHaveBeenCalled();
    expect(p.greet()).toBe('hi from real'); // bound to the real instance, not the proxy
    expect(p.name).toBe('real');
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('raises a build failure at the first use, and only there', () => {
    const p = lazyProvider<Storage>(() => {
      throw new Error('storage: not configured');
    });
    expect(() => p.greet()).toThrow('storage: not configured');
  });

  it('can be awaited or returned from an async function without being built', async () => {
    const build = vi.fn((): Storage => {
      throw new Error('storage: not configured');
    });
    const p = lazyProvider(build);
    await expect((async () => p)()).resolves.toBe(p);
    expect(build).not.toHaveBeenCalled();
  });

  it('answers `in` and `instanceof` for the real provider, and hands out one function per method', () => {
    const p = lazyProvider(() => new Storage());
    expect('greet' in p).toBe(true);
    expect('missing' in p).toBe(false);
    expect(p).toBeInstanceOf(Storage);
    expect(p.greet).toBe(p.greet);
  });
});
