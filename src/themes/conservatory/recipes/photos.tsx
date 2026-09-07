import { GalleryGrid } from '@/components/media/GalleryGrid';
import { ROUTES } from '@/domain/routes';
import type { ContentRecipe, PhotoAlbumProps, PhotosProps } from '@/themes/content-types';
import { PreviewBanner } from '@/themes/shared/PreviewBanner';
import { kit } from '../kit';

const { Shell, Section, SectionHeading, Prose, Link, content } = kit;
const { PageHead } = content;

/**
 * Photos & Video, Conservatory.
 *
 * The gallery's own markup — album list, responsive grid, lightbox, pager — is shared with Gilded
 * Hour, because a photograph is a photograph and `media.css` speaks only in per-theme role tokens.
 * What the recipe supplies is the Shell, the page head, and the sections.
 *
 * `.cv-section__grid` is a 7fr/5fr herbarium sheet at >= 900px, and its children are placed into
 * those tracks in order: text column, then the mounting area. That is right for a section whose
 * second child is a pressed card, and wrong for one whose second child is the section's whole
 * point — the album list landed at x=963 in a 419px column, 650px to the right of the heading that
 * labels it, and split into three 129px columns where a description wrapped at 11 characters
 * against DESIGN.md's 55-72 measure. Heading and content are therefore ONE grid child here.
 */
export const ConservatoryPhotosPage: ContentRecipe<PhotosProps> = ({ albums, canUpload, copy, frame }) => (
  <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
    <PageHead title={copy.title} lede={copy.lede} />

    <Section id="albums" labelledBy="albums-title">
      <div className="cv-section__text">
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
      </div>
    </Section>

    {/* See the note in the Gilded Hour recipe: both these pages were unreachable from the site. */}
    <Section id="find" labelledBy="find-title">
      <div className="cv-section__text">
        <SectionHeading level={2} id="find-title" title="Find a photo" />
        <Prose>
          <p>
            <Link href={ROUTES.photoSearch}>Search the photos</Link> by what you remember — a place, a moment, who you were with. Signed in, you can also ask us to{' '}
            <Link href={ROUTES.photosOfMe}>look for you in them</Link>.
          </p>
        </Prose>
      </div>
    </Section>

    {canUpload ? (
      <Section id="add" ground="wash" labelledBy="add-title">
        <div className="cv-section__text">
          <SectionHeading level={2} id="add-title" title="Add yours" />
          <Prose>
            <p>
              <Link href="/media/upload">Add your photos</Link> · <Link href="/media/mine">My uploads</Link>
            </p>
          </Prose>
        </div>
      </Section>
    ) : null}
  </Shell>
);

export const ConservatoryPhotoAlbumPage: ContentRecipe<PhotoAlbumProps> = ({ slug, title, description, items, nextCursor, copy, frame }) => (
  <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
    <PageHead title={title} {...(description ? { lede: description } : {})} />

    <Section id="grid">
      {/* One grid child for the same reason as above: as two, the pager took the mounting column and
          painted at y=418 x=963 while the grid it follows started at y=417 x=313 — a "back" link
          rendering above and to the right of the content it comes after, at every width >= 900. */}
      <div className="cv-section__text">
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
      </div>
    </Section>
  </Shell>
);
