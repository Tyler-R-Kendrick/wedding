import type { LifecycleState } from '@/contracts/lifecycle';
import type { ActionLink, Copy, HomeContent, HomeSection, Placeholder, SiteFacts, StatProps, TimelineEvent } from '@/themes/types';

/**
 * Home content by lifecycle state (design-doc §3 "Home's job", ADR-0012 §4). Theme-agnostic:
 * both recipes render this model with their own structure. Every sentence traces to
 * docs/design/brief.md; anything the couple has not settled is a typed placeholder.
 */
const todo = (text: string): Placeholder => ({ todo: text });

const ROUTES = {
  story: '/our-story',
  adventures: '/our-adventures',
  share: '/share-an-adventure',
  wedding: '/the-wedding',
  caa: '/explore-caa',
  weekend: '/your-weekend',
  travel: '/travel',
  transport: '/transportation',
  gifts: '/gifts',
  photos: '/photos',
  ask: '/ask-us',
  rsvp: '/rsvp',
} as const;

/** The three events named in the brief; rooms and times are planner items P-01 / P-02. */
export function placeholderTimeline(): TimelineEvent[] {
  return [
    { id: 'ceremony', name: 'Ceremony', placeholder: true },
    { id: 'cocktail-hour', name: 'Cocktail hour', placeholder: true },
    { id: 'reception', name: 'Reception', placeholder: true, description: ['Dinner, toasts, and dancing. ', todo('the music')] },
  ];
}

function sections(site: SiteFacts, state: LifecycleState): Record<string, HomeSection> {
  const venueFacts: StatProps[] = [
    { label: 'Date', value: site.date.long },
    { label: 'Venue', value: site.venue.name },
    { label: 'Address', value: site.venue.address },
  ];
  return {
    adventure: {
      id: 'adventures',
      label: 'Adventure',
      act: 'adventure',
      title: 'Our adventures',
      body: [
        "Museum of Ice Cream. Richardson Farm. Michael Jordan's Steakhouse. Food tastings, gardening together, the Madison waterfront, and Starved Rock, where the first “I love you” happened. ",
        todo('which adventures are public, with our photos'),
      ],
      link: { label: 'Our Adventures', href: ROUTES.adventures },
    },
    place: {
      id: 'the-building',
      label: 'Place',
      act: 'place',
      title: 'The building',
      body: [
        'Built in 1893 for the private Chicago Athletic Association: Henry Ives Cobb’s Venetian Gothic after the Doge’s Palace, opened amid the World’s Columbian Exposition, a club until 2007, restored as a hotel. Patterned brick, carved limestone, stained glass, marble floors, and Millennium Park out the windows.',
      ],
      link: { label: 'Explore CAA', href: ROUTES.caa },
      facts: venueFacts,
      map: true,
    },
    memory: {
      id: 'our-story',
      label: 'Memory',
      act: 'memory',
      title: 'How we met',
      body: ['At Allison and Jamie’s wedding: flirty glances, and a connection that was immediate. ', todo('the rest of the story, in our words')],
      link: { label: 'Our Story', href: ROUTES.story },
    },
    hospitality: {
      id: 'travel',
      label: 'Hospitality',
      act: 'hospitality',
      title: 'Travelling in?',
      body: [
        'Many of you are coming from far away, some with children, some for the whole weekend. Rooms, airports, and getting around will appear here as we confirm them. ',
        todo('hotel block rate, link, and cutoff; which airport to recommend'),
      ],
      link: state === 'TEASER' ? undefined : { label: 'Travel & Stay', href: ROUTES.travel },
    },
    future: {
      id: 'the-date',
      label: 'Future',
      act: 'future',
      title: site.date.long,
      body: ['One date, one building, and a weekend we hope you make your own. Details will land here as they are settled.'],
      link: state === 'TEASER' || state === 'SAVE_THE_DATE' ? undefined : { label: 'The Wedding', href: ROUTES.wedding },
    },
    wedding: {
      id: 'the-wedding',
      label: 'The day',
      act: 'place',
      title: 'The Wedding',
      body: [`${site.date.long} at the ${site.venue.name}. `, todo('ceremony, cocktail hour, and reception rooms and times'), ' ', todo('dress code, with an example outfit')],
      link: { label: 'The Wedding', href: ROUTES.wedding },
      facts: [...venueFacts, { label: 'Ceremony', value: '', placeholder: true }, { label: 'Dress code', value: '', placeholder: true }],
      map: true,
    },
    invitation: {
      id: 'your-invitation',
      label: 'Invitation',
      act: 'future',
      title: 'Your invitation',
      body: ['Claim it with the email we have for you to see your events, RSVP when it opens, and keep your details in one place.'],
      link: { label: 'Claim your invitation', href: ROUTES.weekend },
    },
    rsvp: {
      id: 'rsvp',
      label: 'Reply',
      act: 'future',
      title: 'RSVP',
      body: ['Two minutes on a phone: who is coming, what you would like to eat, anything we should know. Reply by ', todo('the RSVP deadline'), '.'],
      link: { label: 'RSVP', href: ROUTES.rsvp, variant: 'accent' },
    },
    transport: {
      id: 'transportation',
      label: 'Getting there',
      act: 'hospitality',
      title: 'Getting there and home',
      body: ['Valet, transit, parking, and rides home, with the hotel’s own directions. ', todo('event valet rate and ride vouchers')],
      link: { label: 'Transportation', href: ROUTES.transport },
    },
    gifts: {
      id: 'gifts',
      label: 'Gifts',
      act: 'future',
      title: 'Help us with our next adventures',
      body: ['Your being there is the gift. If you would like to give something more, ', todo('registry and experience gifts'), '.'],
      link: { label: 'Gifts', href: ROUTES.gifts },
    },
    weekend: {
      id: 'your-weekend',
      label: 'Yours',
      act: 'hospitality',
      title: 'Your weekend',
      body: ['Your events, your RSVP, your table once it is published, and anything we have arranged for you.'],
      link: { label: 'Your Weekend', href: ROUTES.weekend },
    },
    saturday: {
      id: 'now',
      label: 'Today',
      act: 'now',
      title: state === 'WEDDING_DAY' ? 'Now and next' : 'Saturday',
      body: state === 'WEDDING_DAY' ? ['Where to be, and what comes next.'] : ['The day, in order. Times and rooms will be confirmed here.'],
      timeline: placeholderTimeline(),
      link: { label: 'The Wedding', href: ROUTES.wedding },
    },
    rides: {
      id: 'rides',
      label: 'Getting home',
      act: 'hospitality',
      title: 'A ride home',
      body: ['When you are ready to go. ', todo('ride voucher amount and how to claim it')],
      link: { label: 'Transportation', href: ROUTES.transport },
    },
    open: {
      id: 'whats-open',
      label: 'Open now',
      act: 'place',
      title: 'What’s open in the building',
      body: ['Restaurants and bars on the property, with hours from the hotel’s own site.'],
      link: { label: 'Explore CAA', href: ROUTES.caa },
    },
    ask: {
      id: 'ask',
      label: 'Ask',
      act: 'hospitality',
      title: 'Questions?',
      body: ['Ask us. If we do not have the answer, we will say so and point you to a person.'],
      link: { label: 'Ask Us', href: ROUTES.ask },
    },
    photosToday: {
      id: 'photos',
      label: 'Photos',
      act: 'memory',
      title: 'Photos',
      body: ['Share what you take today; the professional galleries follow later.'],
      link: { label: 'Photos & Video', href: ROUTES.photos },
    },
    photosAfter: {
      id: 'photos',
      label: 'Photos',
      act: 'memory',
      title: 'Your photos',
      body: ['Add the ones you took. Ours will arrive as the photographers deliver them.'],
      link: { label: 'Add photos', href: ROUTES.photos, variant: 'accent' },
    },
    photosArchive: {
      id: 'photos',
      label: 'Photos',
      act: 'memory',
      title: 'Photos & Video',
      body: ['The ceremony, the toasts, the first dances, and everything you captured.'],
      link: { label: 'Photos & Video', href: ROUTES.photos },
    },
    thanks: {
      id: 'thank-you',
      label: 'Thanks',
      act: 'thanks',
      title: 'Thank you',
      body: ['For travelling, for dancing, for being there. ', todo('a note from us')],
    },
  };
}

interface HeroCopy {
  eyebrow: string;
  lede: Copy;
  primary: ActionLink;
  secondary?: ActionLink;
  deadline?: Copy;
}

function hero(site: SiteFacts, state: LifecycleState): HeroCopy {
  const directions: ActionLink = { label: 'Directions', href: site.venue.mapsUrl, variant: 'external', provider: site.venue.mapsProvider };
  switch (state) {
    case 'TEASER':
      return {
        eyebrow: 'We are getting married',
        lede: ['We are inviting the people we love into the places, adventures, and memories that made us. Details as they are settled.'],
        primary: { label: 'Our Story', href: ROUTES.story, variant: 'primary' },
        secondary: { label: 'Explore the building', href: ROUTES.caa, variant: 'ghost' },
      };
    case 'SAVE_THE_DATE':
      return {
        eyebrow: 'Save the date',
        lede: [`${site.date.weekday}, in Chicago. Details to come. If you are travelling in, this page will fill in as we confirm rooms and flights.`],
        primary: { label: 'Travel & Stay', href: ROUTES.travel, variant: 'primary' },
        secondary: { label: 'Our Story', href: ROUTES.story, variant: 'ghost' },
      };
    case 'INVITATIONS_OPEN':
      return {
        eyebrow: 'Invitations are out',
        lede: ['Your invitation is waiting. Claim it with the email we have for you to see your events, then RSVP when it opens.'],
        primary: { label: 'Claim your invitation', href: ROUTES.weekend, variant: 'primary' },
        secondary: { label: 'The Wedding', href: ROUTES.wedding, variant: 'ghost' },
      };
    case 'RSVP_OPEN':
      return {
        eyebrow: 'RSVP is open',
        lede: ['Tell us who is coming. It takes about two minutes, and you can change it later.'],
        primary: { label: 'RSVP', href: ROUTES.rsvp, variant: 'accent' },
        secondary: directions,
        deadline: ['Reply by ', todo('the RSVP deadline'), '.'],
      };
    case 'RSVP_CLOSED':
      return {
        eyebrow: 'See you soon',
        lede: ['RSVPs are in and we cannot wait. Everything for the weekend is below; to change a reply, ask us.'],
        primary: { label: 'The Wedding', href: ROUTES.wedding, variant: 'primary' },
        secondary: directions,
      };
    case 'WEDDING_WEEK':
      return {
        eyebrow: 'Wedding week',
        lede: ['Your itinerary, rides, and what is open in the building, all in one place.'],
        primary: { label: 'Your Weekend', href: ROUTES.weekend, variant: 'primary' },
        secondary: directions,
      };
    case 'WEDDING_DAY':
      return {
        eyebrow: site.coupleDisplayName,
        lede: ['Now and next, your table, and a ride home.'],
        primary: { label: 'Now', href: '#now', variant: 'primary' },
        secondary: { label: 'Ask Us', href: ROUTES.ask, variant: 'ghost' },
      };
    case 'POST_WEDDING':
      return {
        eyebrow: 'Thank you',
        lede: ['For travelling, for dancing, for being there. Add your photos; ours will follow.'],
        primary: { label: 'Add your photos', href: ROUTES.photos, variant: 'accent' },
        secondary: { label: 'Our Story', href: ROUTES.story, variant: 'ghost' },
      };
    case 'ARCHIVE':
      return {
        eyebrow: site.date.long,
        lede: ['The weekend, preserved.'],
        primary: { label: 'Photos & Video', href: ROUTES.photos, variant: 'primary' },
        secondary: { label: 'Our Story', href: ROUTES.story, variant: 'ghost' },
      };
  }
}

const SECTION_ORDER: Record<LifecycleState, string[]> = {
  TEASER: ['adventure', 'place', 'memory', 'hospitality', 'future'],
  SAVE_THE_DATE: ['adventure', 'place', 'memory', 'hospitality', 'future'],
  INVITATIONS_OPEN: ['wedding', 'invitation', 'hospitality', 'transport', 'memory'],
  RSVP_OPEN: ['rsvp', 'wedding', 'hospitality', 'transport', 'gifts', 'memory'],
  RSVP_CLOSED: ['wedding', 'hospitality', 'transport', 'weekend', 'memory'],
  WEDDING_WEEK: ['weekend', 'saturday', 'rides', 'open', 'ask'],
  WEDDING_DAY: ['saturday', 'weekend', 'rides', 'ask', 'photosToday'],
  POST_WEDDING: ['photosAfter', 'thanks', 'memory', 'adventure', 'place'],
  ARCHIVE: ['photosArchive', 'memory', 'adventure', 'place'],
};

export function homeContent(site: SiteFacts, state: LifecycleState): HomeContent {
  const all = sections(site, state);
  const h = hero(site, state);
  return {
    title: state === 'WEDDING_DAY' ? 'Today' : site.coupleDisplayName,
    eyebrow: h.eyebrow,
    lede: h.lede,
    primary: h.primary,
    secondary: h.secondary,
    deadline: h.deadline,
    showCountdown: !['WEDDING_DAY', 'POST_WEDDING', 'ARCHIVE'].includes(state),
    sections: SECTION_ORDER[state].map((key) => all[key]!),
  };
}

/** The five motifs (brief §4) as section eyebrows; "Today" and "Gratitude" for the operate/remember acts. */
export const ACT_LABEL: Record<import('@/themes/types').HomeAct, string> = {
  adventure: 'Adventure',
  place: 'Place',
  memory: 'Memory',
  hospitality: 'Hospitality',
  future: 'Future',
  now: 'Today',
  thanks: 'Gratitude',
};
