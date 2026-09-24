import { assetParams, assetResponse } from '@wedding/wireframe/baseline-routes';

/** The fonts and images the captured pages and stylesheets point at. */
export const dynamic = 'force-static';
export const dynamicParams = false;
export const generateStaticParams = assetParams;

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return assetResponse((await params).path);
}
