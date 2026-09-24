import type { Metadata } from 'next';
import { generatedImageCredits, licensedPhotoCredits, PROFESSIONAL_MEDIA_NOTE } from '@/domain/media/credits';
import { ROUTES } from '@/domain/routes';
import rights from '@/content/photo-rights.json';
import { getTheme } from '@/themes';
import { buildPageFrame, getRequestTheme } from '@/themes/server';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Photo credits' };

/**
 * The credits every licensed photograph on the site asks for, and a plain account of the generated
 * imagery. Linked from the footer of every page, so a credit is always one step from the picture.
 */
export default async function CreditsPage() {
  const theme = await getRequestTheme();
  const frame = await buildPageFrame({ theme, currentPath: '/credits' });
  const Shell = getTheme(theme).kit.Shell;
  const photos = licensedPhotoCredits();
  const generated = generatedImageCredits();
  return (
    <Shell frame={frame}>
      <article className="credits" aria-labelledby="page-title">
        <header className="credits__head">
          <p className="credits__eyebrow">With thanks</p>
          <h1 id="page-title" className="credits__title">
            Photo credits
          </h1>
          <p className="credits__lede">The building and the city are shown in photographs their photographers share under open licences. Each is credited here, with its licence and a link to the original.</p>
        </header>

        {/* The page each photo's embedded rights statement links to (src/content/photo-rights.json). */}
        <section id="rights" className="credits__section" aria-labelledby="credits-ours">
          <h2 id="credits-ours" className="credits__h2">
            Our own photographs
          </h2>
          <p>
            The photographs of Sara and Tyler, and the portraits of them, are ours. {rights.notice} They are here for our guests to enjoy, and they are not licensed to anyone for anything else. Please don’t copy, repost or sell them, and don’t use them to train or prompt an AI model.
          </p>
        </section>

        <section className="credits__section" aria-labelledby="credits-photos">
          <h2 id="credits-photos" className="credits__h2">
            Photographs of the building and the city
          </h2>
          <ul className="credits__list">
            {photos.map((p) => (
              <li key={p.id} className="credits__item">
                <p className="credits__name">{p.title}</p>
                <p>
                  By{' '}
                  {p.authorUrl ? (
                    <a href={p.authorUrl} rel="noopener noreferrer" target="_blank">
                      {p.author}
                    </a>
                  ) : (
                    p.author
                  )}
                  , via{' '}
                  <a href={p.sourcePageUrl} rel="noopener noreferrer" target="_blank">
                    {p.sourceName}
                  </a>
                  ,{' '}
                  {p.licenceUrl ? (
                    <a href={p.licenceUrl} rel="noopener noreferrer license" target="_blank">
                      {p.licence}
                    </a>
                  ) : (
                    p.licence
                  )}
                  . Resized and cropped for this site.
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="credits__section" aria-labelledby="credits-generated">
          <h2 id="credits-generated" className="credits__h2">
            Portraits and flowers
          </h2>
          <ul className="credits__list">
            {generated.map((g) => (
              <li key={g.kind} className="credits__item">
                <p className="credits__name">{g.kind === 'portrait' ? 'Portraits of Sara and Tyler' : 'Flowers and leaves'}</p>
                <p>{g.note}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="credits__section" aria-labelledby="credits-pro">
          <h2 id="credits-pro" className="credits__h2">
            The wedding photographs and films
          </h2>
          <p>
            {PROFESSIONAL_MEDIA_NOTE} They will be on <a href={ROUTES.photos}>Photos &amp; Video</a>.
          </p>
        </section>
      </article>
    </Shell>
  );
}
