import { PAGES, SECTIONS, STAGES, validateSitemap } from '@wedding/sitemap';

export const dynamic = 'force-static';

/** The sitemap as data, for tools outside the pipeline (a planner's spreadsheet, a Figma import). */
export function GET() {
  return Response.json({ sections: SECTIONS, pages: PAGES, stages: STAGES, errors: validateSitemap() });
}
