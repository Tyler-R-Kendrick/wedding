import { GalleryGrid } from '@/components/media/GalleryGrid';
import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, PhotoAlbumProps, PhotosProps } from '@/themes/content-types';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, SectionHeading, Prose, Link, content } = kit;
const { PageHead } = content;

/**
 * Photos & Video, Botanical Hour.
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
export const BotanicalPhotosPage: ContentRecipe<PhotosProps> = ({ albums, canUpload, copy, frame }) => (
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

    {/* Outside the `canUpload` gate on purpose: search had NO inbound link from anywhere in the
        site — a crawl of all sixteen anonymous-reachable pages found zero — so a finished page
        could be reached only by typing the URL. Search needs no account at all. */}
    <Section id="find" labelledBy="find-title">
      <SectionHeading level={2} id="find-title" title="Find a photo" />
      <Prose>
        <p>
          <Link href={ROUTES.photoSearch}>Search the photos</Link> by what you remember — a place, a moment, a colour.
        </p>
      </Prose>
    </Section>

    {/*
      * The section is unconditional; only what it says depends on who is reading.
      *
      * It used to render for `canUpload` alone, so the page that exists to be the guest upload
      * entry point told an anonymous visitor nothing about uploading — and every visitor is
      * anonymous until they open their invitation. A guest who wanted to add a photograph had no
      * way to learn they could, which is not a permission boundary: `/media/upload` enforces that
      * for itself.
      */}
    <Section id="add" ground="alt" labelledBy="add-title">
      <SectionHeading level={2} id="add-title" title="Add yours" />
      <Prose>
        {canUpload ? (
          <p>
            <Link href="/media/upload">Add your photos</Link> · <Link href="/media/mine">My uploads</Link>
          </p>
        ) : (
          <p>
            Guests can add their own photographs from the weekend. Open the link in your invitation to sign in, then{' '}
            <Link href="/media/upload">add your photos</Link>.
          </p>
        )}
      </Prose>
    </Section>
  </Shell>
);

export const BotanicalPhotoAlbumPage: ContentRecipe<PhotoAlbumProps> = ({ slug, title, description, items, nextCursor, copy, frame }) => (
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
