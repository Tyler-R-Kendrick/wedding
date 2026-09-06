import { formatLongDate } from "@/domain/travel";
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
 * Travel & Stay, Conservatory: the botanical reading is a field guide to arriving. The airports are
 * two specimen cards, the room block is the pressed sheet the page opens onto, and the block facts
 * are jar labels — a figure, or a marked gap, never a guess. Where Gilded Hour alternates grounds to
 * step down the page, this one keeps a single washed sheet and lets the cards sit on it, so the two
 * designs read differently before a word is compared.
 */
export const ConservatoryTravelPage: ContentRecipe<TravelProps> = ({
  venue,
  alternatives,
  facts,
  sources,
  slots,
  tripHref,
  frame,
}) => (
  <Shell frame={frame} banner={<PreviewBanner lifecycle={frame.lifecycle} />}>
    <PageHead
      eyebrow="Travel & Stay"
      title="Getting to Chicago"
      lede="How to get here and where to sleep. Every link takes you to the airline or the hotel to book — we never handle payments."
    />

    <Section id="airports" labelledBy="airports-title">
      <SectionHeading
        level={2}
        id="airports-title"
        title="Two airports serve Chicago"
      />
      <div className="cv-travel__airports">
        {facts.airports.map((a) => (
          <Card key={a.code} title={a.code} headingLevel={3} label={a.name}>
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

    <Section id="stay" ground="wash" labelledBy="stay-title">
      <SectionHeading level={2} id="stay-title" title="Where to stay" />
      <Card
        title={venue.name}
        headingLevel={3}
        featured
        label="Where the day happens"
      >
        <Prose>
          <p>
            The wedding is here, so staying here means no travel on the day.
          </p>
          {venue.block?.note ? <p>{venue.block.note}</p> : null}
        </Prose>
        <dl className="cv-stats">
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
              venue.block?.checkIn && venue.block?.checkOut ? (
                `${formatLongDate(venue.block.checkIn)} to ${formatLongDate(venue.block.checkOut)}`
              ) : (
                <Placeholder todo="the block dates" />
              )
            }
          />
          <Stat
            label="Booking code"
            value={
              venue.block?.code ?? (
                <Placeholder todo="the booking code or link" />
              )
            }
          />
        </dl>
        {venue.block?.url ? (
          <p>
            <Link href={venue.block.url} external>
              Book in the room block
            </Link>
          </p>
        ) : null}
        <p>
          <Link href={facts.venue.url} external>
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
                    <Link href={h.bookingUrl} external>
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
      <Prose>
        <p>
          We list why we picked each place (walk time, staffed desk, family
          suites, price, step-free route, transit). We do not rate safety;
          please use your own judgement.
        </p>
      </Prose>
    </Section>

    <Section id="flights" labelledBy="flights-title">
      <SectionHeading level={2} id="flights-title" title="Search flights" />
      {slots.flightSearch}
    </Section>

    <Section id="hotel-rates" labelledBy="rates-title">
      <SectionHeading level={2} id="rates-title" title="Check hotel rates" />
      {slots.hotelSearch}
    </Section>

    <Section id="getting-around" labelledBy="around-title">
      <SectionHeading level={2} id="around-title" title="Getting around" />
      <Prose>
        <p>
          Valet entrance: {facts.venue.valetEntrance}. {facts.venue.valetNote}{" "}
          {facts.venue.valetPending ? (
            <Placeholder todo={facts.venue.valetPending} />
          ) : null}
        </p>
        <p>
          Accessibility and transit directions are on the{" "}
          <Link href={facts.venue.faqUrl} external>
            hotel&rsquo;s FAQ page
          </Link>
          .
        </p>
        <p>
          <Link href={tripHref}>Your trip →</Link>
        </p>
      </Prose>
      <Prose>
        <p>Based on: {sources.map((c) => c.title).join(" · ")}.</p>
      </Prose>
    </Section>
  </Shell>
);
