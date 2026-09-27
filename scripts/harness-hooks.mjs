/** Loader hooks for the review harness: `server-only` and `next/*` runtime modules become inert stubs. */
const STUBS = {
  'server-only': 'export {};',
  'next/navigation': "export const useRouter = () => ({ replace() {}, refresh() {}, push() {} }); export const usePathname = () => '/'; export const notFound = () => { throw new Error('notFound'); };",
  'next/headers': 'export const cookies = async () => ({ get() { return undefined; }, set() {} }); export const headers = async () => new Headers();',
  'next/server': 'export class NextResponse {} export const after = () => {}; export const connection = async () => {};',
};
export async function resolve(specifier, context, next) {
  if (specifier in STUBS) return { url: `stub:${specifier}`, shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.startsWith('stub:')) return { format: 'module', source: STUBS[url.slice(5)], shortCircuit: true };
  // A component's side-effect stylesheet import: the harness inlines the compiled globals.css instead.
  if (url.endsWith('.css')) return { format: 'module', source: 'export {};', shortCircuit: true };
  return next(url, context);
}
