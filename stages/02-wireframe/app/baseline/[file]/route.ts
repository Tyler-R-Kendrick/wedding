import { frameParams, frameResponse } from '@wedding/wireframe/baseline-routes';

/** Each captured page, redrawn at this stage (stages/02-wireframe/lib/baseline.ts). */
export const dynamic = 'force-static';
export const dynamicParams = false;
export const generateStaticParams = () => frameParams('wireframe');

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  return frameResponse('wireframe', (await params).file);
}
