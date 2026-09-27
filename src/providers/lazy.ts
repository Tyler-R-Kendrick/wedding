/**
 * A provider that is built on first use instead of up front. Every property read resolves it once
 * and forwards to it, with methods bound to the real instance. If building it throws, the error
 * comes from the first use, so code that never touches the provider never sees it.
 */
export function lazyProvider<T extends object>(resolve: () => T): T {
  let instance: T | undefined;
  return new Proxy({} as T, {
    get(_target, prop) {
      instance ??= resolve();
      const value: unknown = Reflect.get(instance, prop, instance);
      return typeof value === 'function' ? value.bind(instance) : value;
    },
  });
}
