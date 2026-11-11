import { formatLongDate } from "@/domain/travel";
import {
  blockNights,
  CAA_BOOKING_PHONE,
  CAA_BOOKING_PHONE_REFERENCE,
  CAA_BOOKING_TEL,
  CAA_PARKING_ARRIVAL_COPY,
  CAA_STAY_INTRO,
  CAA_UPGRADES_COPY,
} from "@/domain/travel/stay-copy";
import type { ContentRecipe, TravelProps } from "@/themes/content-types";
import { PreviewBanner } from "@/themes/shared/PreviewBanner";
import { kit } from "../kit";

const { Shell, Section, SectionHeading, Prose, Link, Button, Card, Stat, Placeholder, content } = kit;
const { PageHead, Chips } = content;

/**
 * Your Trip, Botanical Hour: one page for the whole trip, in the order a guest books it.
 *
 * **Stay, then flights, then getting around.** The room block is first because it is the first thing
 * to do and the only one with a deadline. Each fact is said once: the earlier page told a guest to
 * fly into O'Hare and take the Blue Line in three separate sections, and described the valet twice.
 *
 * **Every section uses the page's width.** The earlier page set every paragraph in one 33rem column
 * down the left of a 1200px frame and left the other half empty, which read as an image that had not
 * loaded. Here a section's title sits in a narrow left rail and its content fills the rest
 * (`layout="split"`); within the content, words sit beside the thing they are about — the hotel
 * beside its rate and booking button, the airports beside the search form. On a phone it is one
 * column, in the same order.
 *
 * Nothing here promises what is not decided: there is no line about ride pickup points or ride
 * benefits. If one is settled it is added to "Getting around" then.
 *
 * **Then what to do.** The last section is the planner (`slots.planner`): it took the place of the
 * Things to Do list, so a guest plans the free time on the same page as the room and the flights.
 */
export const BotanicalTravelPage: ContentRecipe<TravelProps> = ({ venue, alternatives, facts, slots, tripHref, frame }) => {
  const block = venue.block && !venue.block.placeholder ? venue.block : null;
  const [recommended, ...otherAirports] = facts.airports;
  return (
    <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
      <PageHead
        title="Your Trip"
        lede="We’re grateful you’re making the trip. Book your room first. Then here is how to get here, how to get around, and what to do while you are here."
      >
        <Chips
          label="On this page"
          items={[
            { label: "Where to stay", href: "#stay" },
            { label: "Flights", href: "#flights" },
            { label: "Getting around", href: "#getting-around" },
            ...(slots.planner ? [{ label: "What to do", href: "#plan" }] : []),
          ]}
        />
      </PageHead>

      <Section id="stay" ground="alt" labelledBy="stay-title" layout="split">
        <SectionHeading level={2} id="stay-title" title="Where to stay" />
        {/* The hotel's name, then the terms and the button, then the words: on a phone the thing to
            do is directly under the name, not below four paragraphs. From 760px the words take the
            left and the terms the right, on one row. */}
        <div className="bd-travel__stay">
          <h3 className="bd-h bd-h--3 bd-travel__name">{venue.name}</h3>
          <aside className="bd-travel__block" aria-label="Our room block">
            {block ? (
              <>
                <dl className="bd-stats bd-travel__terms">
                  <Stat label="Group rate" value={block.rateText ?? <Placeholder todo="the group rate" />} />
                  <Stat label="Book by" value={block.cutoff ? formatLongDate(block.cutoff) : <Placeholder todo="the date to book by" />} />
                  <Stat label="Nights" value={blockNights(block) ?? <Placeholder todo="the block dates" />} />
                  {block.code ? <Stat label="Group code" value={block.code} /> : null}
                </dl>
                {block.url ? (
                  <p>
                    <Button variant="external" href={block.url} provider="the hotel’s booking page" className="bd-btn--solid">
                      Book your room
                    </Button>
                  </p>
                ) : null}
                <p className="bd-muted">
                  Or call{" "}
                  <a className="bd-link bd-travel__tel" href={CAA_BOOKING_TEL}>
                    {CAA_BOOKING_PHONE}
                  </a>{" "}
                  and mention “{CAA_BOOKING_PHONE_REFERENCE}”.
                </p>
              </>
            ) : (
              <p>Room-block details are being confirmed. The booking information will appear here when it is ready.</p>
            )}
          </aside>
          <div className="bd-travel__hotel">
            <Prose>
              <p>{CAA_STAY_INTRO} The wedding is here, so staying here means no travel on the day.</p>
              {frame.details ? (
                <p>
                  <Link href={frame.details.venue.mapsUrl} external standalone>
                    {frame.details.venue.address}
                  </Link>
                </p>
              ) : null}
              <p>{CAA_UPGRADES_COPY}</p>
              <p>
                <Link href={facts.venue.url} external standalone>
                  Visit the hotel website
                </Link>
              </p>
            </Prose>
          </div>
        </div>

        {alternatives.length ? (
          <div className="bd-travel__nearby">
            <h3 className="bd-h bd-h--3">Other hotels close by</h3>
            <ul className="bd-travel__hotels">
              {alternatives.map((h) => (
                <li key={h.id}>
                  <Card title={h.name} headingLevel={4}>
                    <Prose>
                      {h.walkMinutesToVenue ? <p>{h.walkMinutesToVenue} minutes on foot.</p> : null}
                      {h.reasons.length ? (
                        <ul>
                          {h.reasons.map((r, i) => (
                            <li key={i}>{r.text}</li>
                          ))}
                        </ul>
                      ) : null}
                      {h.placeholder ? (
                        <p>
                          <Placeholder todo="the details for this one" />
                        </p>
                      ) : null}
                    </Prose>
                    {h.bookingUrl ? (
                      <p>
                        <Link href={h.bookingUrl} external standalone>
                          Check rates
                        </Link>
                      </p>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
            <p className="bd-muted">We list why we picked each place. We do not rate safety; please use your own judgement.</p>
          </div>
        ) : null}

        <details className="guest-disclosure bd-travel__compare">
          <summary>Compare rates at other hotels nearby</summary>
          <div className="guest-disclosure__body">{slots.hotelSearch}</div>
        </details>
      </Section>

      <Section id="flights" labelledBy="flights-title" layout="split">
        <SectionHeading level={2} id="flights-title" title="Flights" />
        <div className="bd-travel__flights">
          <div className="bd-travel__airports">
            {recommended ? (
              <div className="bd-travel__airport">
                <p className="bd-eyebrow">{recommended.code}</p>
                <h3 className="bd-h bd-h--3">{recommended.name}</h3>
                <p>The airport we recommend. There is no wedding shuttle; getting into the city is below.</p>
                {recommended.pending ? (
                  <p>
                    <Placeholder todo={recommended.pending} />
                  </p>
                ) : null}
              </div>
            ) : null}
            {otherAirports.map((a) => (
              <div key={a.code} className="bd-travel__airport">
                <p className="bd-eyebrow">{a.code}</p>
                <h3 className="bd-h bd-h--3">{a.name}</h3>
                <p>Also serves Chicago.</p>
              </div>
            ))}
            <p className="bd-muted">
              Coming by train? <Link href="https://www.amtrak.com/" external>Amtrak</Link> serves Chicago’s Union Station from cities across the country.
            </p>
          </div>
          <div className="bd-travel__search">
            <h3 className="bd-h bd-h--3">Search flights</h3>
            {slots.flightSearch}
          </div>
        </div>
      </Section>

      <Section id="getting-around" ground="alt" labelledBy="around-title" layout="split">
        <SectionHeading level={2} id="around-title" title="Getting around" />
        <dl className="bd-travel__ways">
          <div className="bd-travel__way">
            <dt>Trains and buses</dt>
            <dd>
              The CTA “L” and buses run downtown and to both airports; the Blue Line connects O’Hare to the Loop. Routes and fares are on the{" "}
              <Link href="https://www.transitchicago.com/" external>Chicago Transit Authority</Link> site.
            </dd>
          </div>
          <div className="bd-travel__way">
            <dt>Taxis and rideshare</dt>
            <dd>Taxis and rideshares serve both airports and the hotel.</dd>
          </div>
          <div className="bd-travel__way">
            <dt>Driving and parking</dt>
            <dd>{CAA_PARKING_ARRIVAL_COPY} Rates and availability may change before the wedding.</dd>
          </div>
          <div className="bd-travel__way">
            <dt>Accessibility</dt>
            <dd>
              Step-free routes and transit directions are on the{" "}
              <span className="bd-nowrap">
                <Link href={facts.venue.faqUrl} external>hotel’s FAQ page</Link>.
              </span>
            </dd>
          </div>
        </dl>
      </Section>

      {slots.planner ? (
        <Section id="plan" labelledBy="plan-title" layout="split">
          <SectionHeading level={2} id="plan-title" title="What to do" />
          <div className="bd-travel__plan">
            <Prose>
              <p>
                Tell us what you are in the mood for and we will suggest a few of our own favorite places. Save the ones you like to your weekend.
                Your flights and hotel, kept on <Link href={tripHref}>Your flights and hotel</Link>, join it on your calendar.
              </p>
            </Prose>
            {slots.planner}
          </div>
        </Section>
      ) : null}
    </Shell>
  );
};
