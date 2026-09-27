import { describe, expect, it, vi } from 'vitest';
import { lazyProvider } from '@/providers/lazy';

describe('lazyProvider', () => {
  it('builds nothing until used, then builds once', () => {
    const build = vi.fn(() => ({ name: 'real', greet(this: { name: string }) { return `hi from ${this.name}`; } }));
    const p = lazyProvider(build);
    expect(build).not.toHaveBeenCalled();
    expect(p.greet()).toBe('hi from real'); // bound to the real instance, not the proxy
    expect(p.name).toBe('real');
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('raises a build failure at the first use, and only there', () => {
    const p = lazyProvider<{ get(): number }>(() => {
      throw new Error('storage: not configured');
    });
    expect(() => p.get()).toThrow('storage: not configured');
  });
});
