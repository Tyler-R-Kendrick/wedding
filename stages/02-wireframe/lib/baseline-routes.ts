/**
 * What each stage's `app/baseline/**` route handlers export, so stages 2, 3 and 4 write the same
 * files at build (static export turns each GET into a file under out/baseline/):
 *
 *   /baseline/<page>[.<design>].html   the captured page, redrawn at this stage (lib/baseline.ts)
 *   /baseline/css/<hash>.css           the real site's stylesheets, their url()s re-rooted
 *   /baseline/a/<path>                 the fonts and images those point at
 */
import { asset, assetFiles, cssFiles, frameDocument, frameFiles, parseFrameName, stylesheet, type FrameStage } from './baseline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const notFound = () => new Response('Not in the baseline', { status: 404 });

export const frameParams = (stage: FrameStage) => frameFiles(stage).map((file) => ({ file }));
export function frameResponse(stage: FrameStage, file: string): Response {
  const parsed = parseFrameName(file);
  const html = parsed && frameDocument(parsed.pageId, parsed.design, stage, BASE);
  return html ? new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }) : notFound();
}

export const cssParams = () => cssFiles().map((file) => ({ file }));
export function cssResponse(file: string): Response {
  const css = stylesheet(file, BASE);
  return css === null ? notFound() : new Response(css, { headers: { 'content-type': 'text/css; charset=utf-8' } });
}

export const assetParams = () => assetFiles().map((path) => ({ path }));
const TYPES: Record<string, string> = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', ico: 'image/x-icon' };
export function assetResponse(path: string[]): Response {
  const bytes = asset(path);
  const ext = path.at(-1)?.split('.').pop()?.toLowerCase() ?? '';
  return bytes ? new Response(new Uint8Array(bytes), { headers: { 'content-type': TYPES[ext] ?? 'application/octet-stream' } }) : notFound();
}
