import { GalleryGrid } from '@/components/media/GalleryGrid';
import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, PhotoAlbumProps, PhotosProps } from '@/themes/content-types';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, SectionHeading, Prose, Link, content } = kit;
const { PageHead } = content;

/**
 * Photos & Video, Gilded Hour.
 *
 * The gallery's own markup is shared with Conservatory — album list, responsive grid, lightbox,
 * pager — because a photograph is a photograph and `media.css` already speaks only in per-theme
 * role tokens. What differs is what a recipe is for: the Shell, the page head, the section grounds.
 *
 * Rendered bare (as it was), `/photos` had no nav, no design switcher, an h1 in the TEXT face at one
 * fixed size in both designs, and — with JavaScript disabled — Times New Roman, because nothing
 * above it carried `[data-theme]` and every `var(--color-*)` was therefore invalid at
 * computed-value time. `/gifts` next door was correct in that same window. This closes it the same
 * way level 09 did: the design's Shell, server-rendered.
 */
export const GildedPhotosPage: ContentRecipe<PhotosProps> = ({ albums, canUpload, copy, frame }) => (
  <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
    <PageHead title={copy.title} lede={copy.lede} />

    <Section id="albums" labelledBy="albums-title">
      <SectionHeading level={2} id="albums-title" title="Albums" />
      {albums.length === 0 ? (
        <Prose>
          <p role="status">{copy.empty}</p>
        </Prose>
      ) : (
        <ul className="media-albums">
          {albums.map((c: PhotosProps['albums'][number]) => (
            <li key={c.slug} className="media-album">
              <Link href={`${ROUTES.photos}/${c.slug}`}>{c.title}</Link>
              {c.description ? <span className="media-lede">{c.description}</span> : null}
              <span className="media-album__count">{c.itemCount === 0 ? 'Nothing here yet' : c.itemCount === 1 ? '1 item' : `${c.itemCount} items`}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>

    {/* Outside the `canUpload` gate on purpose. Search and "photos of me" had NO inbound link from
        anywhere in the site — a crawl of all sixteen anonymous-reachable pages found zero — so two
        finished pages could be reached only by typing the URL. Search needs no account at all. */}
    <Section id="find" labelledBy="find-title">
      <SectionHeading level={2} id="find-title" title="Find a photo" />
      <Prose>
        <p>
          <Link href={ROUTES.photoSearch}>Search the photos</Link> by what you remember — a place, a moment, who you were with. Signed in, you can also ask us to{' '}
          <Link href={ROUTES.photosOfMe}>look for you in them</Link>.
        </p>
      </Prose>
    </Section>

    {canUpload ? (
      <Section id="add" ground="alt" labelledBy="add-title">
        <SectionHeading level={2} id="add-title" title="Add yours" />
        <Prose>
          <p>
            <Link href="/media/upload">Add your photos</Link> · <Link href="/media/mine">My uploads</Link>
          </p>
        </Prose>
      </Section>
    ) : null}
  </Shell>
);

export const GildedPhotoAlbumPage: ContentRecipe<PhotoAlbumProps> = ({ slug, title, description, items, nextCursor, copy, frame }) => (
  <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
    <PageHead title={title} {...(description ? { lede: description } : {})} />

    <Section id="grid">
      <GalleryGrid items={items} emptyMessage={copy.empty} />
      <Prose>
        <p className="media-pager">
          {nextCursor ? (
            <Link href={`${ROUTES.photos}/${slug}?cursor=${encodeURIComponent(nextCursor)}`} rel="next">
              {copy.showMore}
            </Link>
          ) : null}
          <Link href={ROUTES.photos}>{copy.allAlbums}</Link>
        </p>
      </Prose>
    </Section>
  </Shell>
);
