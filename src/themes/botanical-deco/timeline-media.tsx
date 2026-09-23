import manifest from '../../../public/media/timeline/manifest.json';

/**
 * Photographs on the Our Story line (`public/media/timeline/manifest.json`, written by
 * `scripts/timeline-media.mjs` and `scripts/import-paired.mjs`). A timeline record names one `src`;
 * this resolves it to the responsive set, its intrinsic size, and two facts a guest is owed: whether
 * the picture is a stand-in for one of the couple's own, and the credit its licence asks for.
 *
 * A `src` the manifest does not know (an admin pointed a record at another file under /public) still
 * renders, as a plain image: an unknown path is never an empty frame.
 */

interface TimelineFile {
  src: string;
  format: string;
  width: number;
}
interface TimelineItem {
  id: string;
  src: string;
  intrinsic: { width: number; height: number };
  files: TimelineFile[];
  standIn: boolean;
  alt: string;
  credit: string | null;
  creditUrl: string | null;
}

const BY_SRC = new Map<string, TimelineItem>((manifest.items as TimelineItem[]).map((i) => [i.src, i]));

const srcset = (item: TimelineItem, format: string) =>
  item.files
    .filter((f) => f.format === format)
    .sort((a, b) => a.width - b.width)
    .map((f) => `${f.src} ${f.width}w`)
    .join(', ');

export interface TimelinePhotoProps {
  src: string;
  alt: string;
  sizes: string;
  /** The line colour the stand-in label sits on is the card's, not the photo's. */
  className?: string;
}

export function TimelinePhoto({ src, alt, sizes, className }: TimelinePhotoProps) {
  const item = BY_SRC.get(src);
  return (
    <figure className={`bd-stopcard__media${className ? ` ${className}` : ''}`}>
      {item ? (
        <picture>
          <source type="image/avif" srcSet={srcset(item, 'avif')} sizes={sizes} />
          {/* Responsive <picture> with AVIF first; next/image would add a runtime for no gain here. */}
          <img src={item.src} srcSet={srcset(item, 'jpg')} sizes={sizes} width={item.intrinsic.width} height={item.intrinsic.height} alt={alt} loading="lazy" decoding="async" />
        </picture>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a path outside the manifest has no size set to offer
        <img src={src} alt={alt} loading="lazy" decoding="async" />
      )}
      {item?.standIn ? <span className="bd-stopcard__standin">Stand-in photo</span> : null}
      {item?.credit ? (
        <figcaption className="bd-stopcard__credit">
          {item.creditUrl ? (
            <a className="bd-stopcard__license" href={item.creditUrl} rel="noopener noreferrer">
              {item.credit}
            </a>
          ) : (
            item.credit
          )}
        </figcaption>
      ) : null}
    </figure>
  );
}
