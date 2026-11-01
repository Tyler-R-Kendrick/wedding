import { formatLongDate } from "@/domain/travel";
import {
  CAA_BOOKING_LINK_LABEL,
  CAA_BOOKING_PHONE,
  CAA_BOOKING_PHONE_REFERENCE,
  CAA_PARKING_ARRIVAL_COPY,
  CAA_STAY_INTRO,
  CAA_UPGRADES_COPY,
  venueBlockDatesLabel,
} from "@/domain/travel/stay-copy";
import type { ContentRecipe, TravelProps } from "@/themes/content-types";
import { PreviewBanner } from "@/themes/shared/PreviewBanner";
import { kit } from "../kit";

const {
  Shell,
  Section,
  SectionHeading,
  Prose,
  Link,
  Card,
  Stat,
  Placeholder,
  content,
} = kit;
const { PageHead } = content;

/**
 * Travel & Stay, Botanical Hour.
 *
 * What differs from Conservatory is the kit and the grounds: deco plaques, stepped frames and a
 * symmetrical spine here; specimen labels, a sky wash and asymmetry there. The information
 * architecture is deliberately the same in both — airports, stay, flights, rates, getting around —
 * because a guest comparing designs should find the page, not learn a new one.
 *
 * Stated plainly because an earlier version of this comment did not: this is one IA in two
 * expressions, not two compositions. A first design review called that out, and making the two
 * pages structurally different is the next round's work, not something to claim here.
 */
export const BotanicalTravelPage: ContentRecipe<TravelProps> = ({
  venue,
  alternatives,
  facts,
  sources,
  slots,
  tripHref,
  signedIn = false,
  frame,
}) => (
  <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
    <PageHead
      eyebrow="Travel & Stay"
      title="Getting to Chicago"
      lede="We know many of you will be traveling to join us, and we’re grateful you’re making the trip. Here’s some helpful information to make planning your stay a little easier. We’ll add more details as our plans come together."
    />

    <Section id="arriving" labelledBy="arriving-title">
      <SectionHeading level={2} id="arriving-title" title="Getting to Chicago" />
      <Prose>
        <p>
          We recommend flying into O&apos;Hare (ORD). There is no wedding shuttle; take the CTA Blue Line &ldquo;L&rdquo; train into downtown. Visit the{' '}
          <Link href="https://www.transitchicago.com/" external>Chicago Transit Authority</Link> for routes and service information.
        </p>
        <p>Rideshare pickup details at the airport are coming soon. Uber can take you from the airport to the hotel.</p>
        <p>Midway (MDW) also serves Chicago with trains, taxis, and rideshare into downtown.</p>
        <p>By train: <Link href="https://www.amtrak.com/" external>Amtrak</Link> serves Chicago&apos;s Union Station from cities throughout the country.</p>
        <p>By car: {CAA_PARKING_ARRIVAL_COPY} Parking rates and availability may change before the wedding.</p>
        <p><Link standalone href={tripHref}>{signedIn ? 'Your guest travel details and weekend plans →' : 'Sign in for guest booking details and your weekend plans →'}</Link></p>
      </Prose>
    </Section>

    <Section id="airports" labelledBy="airports-title">
      <SectionHeading
        level={2}
        id="airports-title"
        title="Two airports serve Chicago"
      />
      <div className="bd-travel__airports">
        {facts.airports.map((a) => (
          <Card key={a.code} title={a.name} headingLevel={3} label={a.code}>
            <Prose>{a.note ? <p>{a.note}</p> : null}</Prose>
          </Card>
        ))}
      </div>
      {facts.airports[0]?.pending ? (
        <p>
          <Placeholder todo={facts.airports[0].pending} />
        </p>
      ) : null}
    </Section>

    <Section id="stay" ground="alt" labelledBy="stay-title">
      <SectionHeading level={2} id="stay-title" title="Where to stay" />
      <Card title={venue.name} headingLevel={3} featured>
        <Prose>
          <p>{CAA_STAY_INTRO}</p>
          {venue.address ? <p>{venue.address}</p> : facts.venue.address ? <p>{facts.venue.address}</p> : null}
          <p>The wedding is here, so staying here means no travel on the day.</p>
        </Prose>
        {venue.block ? <dl className="bd-stats">
          <Stat
            label="Group rate"
            value={
              venue.block?.rateText ?? <Placeholder todo="the group rate" />
            }
          />
          <Stat
            label="Book by"
            value={
              venue.block?.cutoff ? (
                formatLongDate(venue.block.cutoff)
              ) : (
                <Placeholder todo="the date to book by" />
              )
            }
          />
          <Stat
            label="Block dates"
            value={
              venueBlockDatesLabel(venue.block) ?? (
                venue.block?.checkIn && venue.block?.checkOut ? (
                  `${formatLongDate(venue.block.checkIn)} to ${formatLongDate(venue.block.checkOut)}`
                ) : (
                  <Placeholder todo="the block dates" />
                )
              )
            }
          />
        </dl> : <Prose>{signedIn ? <p>Room-block details are being confirmed. We’ll share the booking information here when it is ready.</p> : <p><Link standalone href="/sign-in?next=%2Ftravel">Sign in for room-block details as they are confirmed →</Link></p>}</Prose>}
        {venue.block ? (
          <Prose>
            {venue.block.url ? (
              <p>
                <Link href={venue.block.url} external standalone>
                  {CAA_BOOKING_LINK_LABEL}
                </Link>
              </p>
            ) : null}
            <p>
              Or call {CAA_BOOKING_PHONE} (reference &ldquo;{CAA_BOOKING_PHONE_REFERENCE}&rdquo;).
            </p>
          </Prose>
        ) : null}
        <Prose><p>{CAA_UPGRADES_COPY}</p></Prose>
        <p>
          <Link href={facts.venue.url} external standalone>
            Visit the hotel website
          </Link>
        </p>
      </Card>

      <SectionHeading level={3} title="Nearby, hand-picked" />
      {alternatives.length ? (
        <ul className="list list--plain">
          {alternatives.map((h) => (
            <li key={h.id}>
              <Card title={h.name} headingLevel={4}>
                <Prose>
                  {h.walkMinutesToVenue ? (
                    <p>{h.walkMinutesToVenue} minutes on foot.</p>
                  ) : null}
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
      ) : (
        <Prose>
          <p>
            We are still confirming a few nearby options at different prices.{" "}
            <Placeholder todo="which hotels we recommend nearby" />
          </p>
        </Prose>
      )}
      {/* "We list why we picked each place" sat outside the ternary, so with no hotels configured
          it rendered directly under "we are still confirming a few nearby options" — a present-tense
          description of a list that does not exist. It belongs with the list it describes. */}
      {alternatives.length ? (
        <Prose>
          <p>
            We list why we picked each place (walk time, staffed desk, family
            suites, price, step-free route, transit). We do not rate safety;
            please use your own judgement.
          </p>
        </Prose>
      ) : null}
    </Section>

    <Section id="flights" labelledBy="flights-title">
      <SectionHeading level={2} id="flights-title" title="Search flights" />
      {slots.flightSearch}
    </Section>

    <Section id="hotel-rates" ground="alt" labelledBy="rates-title">
      <SectionHeading level={2} id="rates-title" title="Check hotel rates" />
      {slots.hotelSearch}
    </Section>

    <Section id="make-a-trip" labelledBy="make-a-trip-title">
      <SectionHeading level={2} id="make-a-trip-title" title="Make a trip of it" />
      <Prose><p>Planning extra time in the city? We’d love for you to enjoy Chicago while you’re here.</p><p><Link standalone href={signedIn ? '/share-an-adventure' : '/sign-in?next=%2Fshare-an-adventure'}>Explore our Chicago guide and map →</Link></p><p>We’re so grateful you’re making the trip to celebrate with us and can’t wait to make wonderful memories together!</p></Prose>
    </Section>

    <Section id="getting-around" labelledBy="around-title">
      <SectionHeading level={2} id="around-title" title="Getting around" />
      <Prose>
        <p>
          Valet entrance: {facts.venue.valetEntrance}. {facts.venue.valetNote}
        </p>
        <p>
          The CTA &ldquo;L&rdquo; and buses run downtown and to the airports. Visit the{' '}
          <Link href="https://www.transitchicago.com/" external>Chicago Transit Authority</Link> for routes and fares.
        </p>
        <p>Taxis and rideshares serve the hotel; rideshare pickup details are coming soon. Uber can take you from the airport to the hotel.</p>
        <p>
          Accessibility and transit directions are on the{' '}
          <span className="bd-nowrap">
            <Link href={facts.venue.faqUrl} external>
              hotel&rsquo;s FAQ page
            </Link>
            .
          </span>
        </p>
        <p>
          <Link href={tripHref} standalone>Your trip →</Link>
        </p>
      </Prose>
      <Prose>
        <p>Based on: {sources.map((c) => c.title).join(" · ")}.</p>
      </Prose>
    </Section>
  </Shell>
);
