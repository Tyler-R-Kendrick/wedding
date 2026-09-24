import { cssParams, cssResponse } from '@wedding/wireframe/baseline-routes';

/** The real site's stylesheets, as captured. */
export const dynamic = 'force-static';
export const dynamicParams = false;
export const generateStaticParams = cssParams;

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  return cssResponse((await params).file);
}
