import type { ReactNode } from 'react';
import type { StorySectionView } from '@/domain/content/views';
import { StoryMediaCarousel } from './StoryMediaCarousel';

export interface StorySectionMediaProps {
  section: Pick<StorySectionView, 'title' | 'media'>;
  /** Wrap each slide (e.g. botanical TimelinePhoto). Default: plain responsive img. */
  renderSlide?: (media: StorySectionView['media'][number], index: number) => ReactNode;
  className?: string;
}

function DefaultSlide({ media }: { media: StorySectionView['media'][number] }) {
  if (!media.src) return null;
  return (
    <figure>
      {/* eslint-disable-next-line @next/next/no-img-element -- seed paths may sit outside next/image domains */}
      <img src={media.src} alt={media.alt} loading="lazy" decoding="async" />
      {media.caption ? <figcaption>{media.caption}</figcaption> : null}
    </figure>
  );
}

/** One photograph or a carousel when a merged chapter carries several. */
export function StorySectionMedia({ section, renderSlide, className }: StorySectionMediaProps) {
  const items = section.media.filter((m) => m.src);
  if (!items.length) return null;
  const slides = items.map((m, i) => (renderSlide ? renderSlide(m, i) : <DefaultSlide key={m.src ?? i} media={m} />));
  return <StoryMediaCarousel label={section.title} slides={slides} className={className} />;
}
