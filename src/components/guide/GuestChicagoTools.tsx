import 'server-only';
import { Text as Block } from '@/components/provenance';
import type { RecommendationCard } from '@/domain/content/views';
import { getTheme } from '@/themes';
import { getRequestTheme } from '@/themes/server';
import { AdventureAtlas, type AtlasPin } from '@/themes/botanical-deco/kit/AdventureAtlas';

/** Only rendered by the guide route for a signed-in guest, using already-scoped cards. */
export async function GuestChicagoTools({ recommendations }: { recommendations: RecommendationCard[] }) {
  const { Section, SectionHeading, Prose, Link } = getTheme(await getRequestTheme()).kit;
  // A map pin looks like a settled recommendation. Drafts remain labelled in the list below.
  const located = recommendations.filter((r) => !r.draft && !r.placeholder && r.place?.coordinates);
  const pins: AtlasPin[] = located.map((r, i) => ({
    id: r.id,
    title: r.title,
    number: String(i + 1).padStart(2, '0'),
    ...r.place!.coordinates!,
  }));
  return (
    <>
      <Section id="chicago-map" labelledBy="chicago-map-title">
        <SectionHeading level={2} id="chicago-map-title" title="Our Chicago Guide" />
        <Prose>
          <p>Explore our recommendations on the map, then open a place for directions. Pins show approximate locations; confirm your destination before heading out. Tours, experiences without a fixed meeting point, and recommendations we’re still putting together are in the list below.</p>
        </Prose>
        {/* The shared illustration carries its own palette in every site theme. */}
        <div data-theme="botanical-deco">
          <AdventureAtlas
            pins={pins}
            subject="Chicago recommendations"
            venue={{ id: 'venue', name: 'Chicago Athletic Association', lat: 41.8815, lng: -87.6246 }}
            overview={<p>Food and drinks, attractions and architecture, parks and museums, with our wedding venue as your starting point.</p>}
            postcards={
              <>
                {located.map((r) => (
                  <article className="bd-postcard" key={r.id} data-atlas-entry={r.id} aria-labelledby={`guide-pin-${r.id}`}>
                    <button className="bd-postcard__close" type="button" data-atlas-close aria-label={`Close ${r.title}`}>×</button>
                    <h3 className="bd-postcard__title" id={`guide-pin-${r.id}`} tabIndex={-1} data-atlas-focus>{r.title}</h3>
                    <Block block={r.what} />
                    {r.handoffs.directions ? (
                      <p><Link standalone href={r.handoffs.directions.url} external>Get directions in Google Maps</Link></p>
                    ) : null}
                    <p><Link standalone href={r.href}>Read more about this place</Link></p>
                  </article>
                ))}
                <article className="bd-postcard" data-atlas-entry="venue" aria-labelledby="guide-venue-title">
                  <button className="bd-postcard__close" type="button" data-atlas-close aria-label="Close wedding venue">×</button>
                  <h3 className="bd-postcard__title" id="guide-venue-title" tabIndex={-1} data-atlas-focus>Chicago Athletic Association</h3>
                  <p>Our wedding venue, across from Millennium Park.</p>
                  <p><Link standalone href="/our-venue">Explore our venue →</Link></p>
                </article>
              </>
            }
          >
            {null}
          </AdventureAtlas>
        </div>
        <Prose>
          <p><Link standalone href="/trip">Create or update your personal agenda →</Link></p>
          <p><Link standalone href="/rsvp/meals">Review your meal selections →</Link> Meal choices and changes open when the menu is ready and remain available during the meal editing window.</p>
        </Prose>
      </Section>
      <Section id="exploring-tips" labelledBy="exploring-tips-title">
        <SectionHeading level={2} id="exploring-tips-title" title="Make a trip of it" />
        <Prose>
          <p>Book popular restaurants, rooftop spots, tours, and attractions ahead. Group nearby activities together, wear comfortable walking shoes, and check the July forecast. You don’t need a packed itinerary to enjoy Chicago!</p>
          <p>Downtown is walkable, and CTA buses and trains connect many parts of the city. Taxis and rideshare services are also available. Stay aware of your surroundings, keep valuables secure, and choose well-lit, populated routes at night. Plan your return before heading out.</p>
          <p>Confirm attraction hours, tickets, tour meeting points, and transit routes before you go. For transit information, visit the <Link href="https://www.transitchicago.com/" external>Chicago Transit Authority</Link>.</p>
          <p>We’re so happy you’re making the trip to celebrate with us. We hope you enjoy exploring the city, and we can’t wait to see you!</p>
        </Prose>
      </Section>
    </>
  );
}
