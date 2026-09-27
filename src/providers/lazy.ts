/**
 * A provider that is built on first use instead of up front. Reads, `in` and `instanceof` resolve it
 * once and forward to it, with each method bound to the real instance (the same function every time).
 * If building it throws, the error comes from the first use, so code that never touches the provider
 * never sees it. It is not a thenable: `await`ing it, or returning it from an async function, does
 * not build it just to look for `then`.
 */
export function lazyProvider<T extends object>(resolve: () => T): T {
  let instance: T | undefined;
  const real = (): T => (instance ??= resolve());
  const bound = new Map<PropertyKey, unknown>();
  return new Proxy({} as T, {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      const target = real();
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (!bound.has(prop)) bound.set(prop, value.bind(target));
      return bound.get(prop);
    },
    has: (_target, prop) => Reflect.has(real(), prop),
    getPrototypeOf: () => Reflect.getPrototypeOf(real()),
  });
}
