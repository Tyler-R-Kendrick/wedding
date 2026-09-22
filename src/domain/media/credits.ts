import ledger from '../../../public/assets/attributions.json';
import manifest from '../../../public/media/botanical-deco/manifest.json';

/**
 * Who made the pictures on this site, for `/credits`.
 *
 * The Wikimedia Commons photographs are published under CC BY and CC BY-SA, which require a credit
 * a visitor can find: the author, the licence and where the original lives. The licence ledger
 * (`public/assets/attributions.json`, kept honest by `npm run assets:check`) already holds all of
 * that, so this page is generated from it rather than typed a second time.
 *
 * The generated imagery is listed too, and says what it is: the portraits are generated
 * portrayals the couple approved, not photographs of any event (PRODUCT.md never lets AI imagery
 * pass as a photo of the couple), and the flowers are painted ornament from the same designs.
 */

export interface LicensedPhotoCredit {
  id: string;
  title: string;
  author: string;
  authorUrl: string | null;
  sourcePageUrl: string;
  sourceName: string;
  licence: string;
  licenceUrl: string;
}

export interface GeneratedImageCredit {
  kind: 'portrait' | 'ornament';
  count: number;
  note: string;
}

interface LedgerAsset {
  id: string;
  title: string;
  author?: string;
  authorUrl?: string;
  sourcePageUrl: string;
  sourceName?: string;
  license: { shortName: string; url?: string };
}

interface ManifestItem {
  id: string;
  kind: string;
  sourceType: string;
}

const tidyTitle = (t: string) =>
  t
    .replace(/^File:/, '')
    .replace(/\.(jpe?g|png|tiff?|webp)$/i, '')
    .replace(/\s*\(\d{6,}\)$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function licensedPhotoCredits(): LicensedPhotoCredit[] {
  return (ledger.assets as LedgerAsset[]).map((a) => ({
    id: a.id,
    title: tidyTitle(a.title),
    author: a.author?.trim() || 'Unknown author',
    authorUrl: a.authorUrl || null,
    sourcePageUrl: a.sourcePageUrl,
    sourceName: a.sourceName ?? 'Wikimedia Commons',
    licence: a.license.shortName,
    licenceUrl: a.license.url ?? '',
  }));
}

export function generatedImageCredits(): GeneratedImageCredit[] {
  const items = manifest.items as ManifestItem[];
  const portraits = items.filter((i) => i.sourceType === 'generated-portrayal' && !i.id.endsWith('.mobile')).length;
  const ornaments = items.filter((i) => i.sourceType === 'generated-ornament').length;
  return [
    {
      kind: 'portrait',
      count: portraits,
      note: 'Generated portraits of Sara and Tyler, made for and approved by them. They are not photographs of any event, and they are stand-ins until the finished portraits arrive.',
    },
    {
      kind: 'ornament',
      count: ornaments,
      note: 'Painted flowers and leaves from the same approved designs, used as decoration.',
    },
  ];
}

/** Named on the contract; their work appears on Photos & Video once it is imported. */
export const PROFESSIONAL_MEDIA_NOTE = 'Photographs by Brooke Alaina Photography and films by Oakhouse Visuals are shared here for personal, non-commercial viewing.';
