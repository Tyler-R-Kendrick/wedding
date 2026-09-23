import type { WireframeSpec } from '../types';

export const PUBLIC: Record<string, WireframeSpec> = {
  home: {
    status: 'review',
    blocks: [
      {
        kind: 'masthead', id: 'hero', media: 'portrait', title: 'Names', lede: 'Date · place',
        actions: [{ label: 'State action', to: 'rsvp', variant: 'primary' }, { label: 'Our Story', to: 'story', variant: 'secondary' }],
        note: 'One action per lifecycle state. Portrait of the couple is a real photograph or nothing.',
      },
      { kind: 'facts', id: 'countdown', label: 'Countdown and the weekend at a glance', items: ['Days to go', 'Date', 'Place', 'Dress code'] },
      { kind: 'prose', id: 'story-teaser', label: 'Story teaser', paragraphs: 1 },
      { kind: 'collection', id: 'next', label: 'Where to go next', item: 'Section', count: 4, layout: 'list', note: 'Order follows the lifecycle: what a guest needs now comes first.' },
    ],
  },
  story: {
    status: 'review',
    blocks: [
      { kind: 'masthead', title: 'Our Story', lede: 'One line on what this page is' },
      { kind: 'timeline', id: 'chapters', label: 'Chapters', items: ['How we met', 'Connection', 'Relationship', 'Love', 'Future', 'Engagement', 'What marriage means'], note: 'Each chapter opens in place; the reader never loses their position.' },
      { kind: 'media', id: 'chapter-media', label: 'Photo per chapter', aspect: 'portrait', count: 1 },
      { kind: 'callout', label: 'Keep going', action: { label: 'Our Adventures', to: 'adventures' } },
    ],
  },
  adventures: {
    status: 'review',
    blocks: [
      { kind: 'masthead', title: 'Our Adventures', lede: 'Where we have been' },
      { kind: 'map', id: 'atlas', label: 'Atlas of places', pins: 8, note: 'Zoomable. Every pin is also in the list below, so the map is never the only way in.' },
      { kind: 'collection', id: 'places', label: 'Places', item: 'Adventure', count: 6, layout: 'grid', to: 'adventure', media: true },
    ],
  },
  adventure: {
    status: 'draft',
    blocks: [
      { kind: 'masthead', title: 'Place name', lede: 'When', media: 'wide' },
      { kind: 'split', columns: [[{ kind: 'prose', label: 'Sara remembers', paragraphs: 2 }], [{ kind: 'prose', label: 'Tyler remembers', paragraphs: 2 }]] },
      { kind: 'media', label: 'Photos from the trip', aspect: 'square', count: 6 },
      { kind: 'callout', label: 'Back to all places', action: { label: 'The atlas', to: 'adventures' } },
    ],
  },
  share: {
    status: 'draft',
    blocks: [
      { kind: 'masthead', title: 'Share an Adventure', lede: 'Our Chicago, for your weekend' },
      { kind: 'tabs', id: 'itineraries', label: 'Itineraries', tabs: [
        { title: 'An afternoon', blocks: [{ kind: 'collection', label: 'Stops', item: 'Stop', count: 3, layout: 'list', to: 'share-item' }] },
        { title: 'A full day', blocks: [{ kind: 'collection', label: 'Stops', item: 'Stop', count: 5, layout: 'list', to: 'share-item' }] },
        { title: 'On foot', blocks: [{ kind: 'collection', label: 'Stops', item: 'Stop', count: 4, layout: 'list', to: 'share-item' }] },
      ] },
      { kind: 'collection', label: 'Every recommendation', item: 'Recommendation', count: 8, layout: 'grid', to: 'share-item', media: true },
    ],
  },
  'share-item': {
    status: 'draft',
    blocks: [
      { kind: 'masthead', title: 'Place name', lede: 'Kind of place · neighbourhood', media: 'wide' },
      { kind: 'facts', label: 'Practical layer', items: ['Distance from the venue', 'Getting there', 'Hours', 'Price range'] },
      { kind: 'prose', label: 'Why we love it (memory layer)', paragraphs: 2 },
      { kind: 'map', label: 'Where it is', pins: 1 },
    ],
  },
  wedding: {
    status: 'review',
    blocks: [
      { kind: 'masthead', title: 'The Wedding', lede: 'Date · venue' },
      { kind: 'timeline', id: 'schedule', label: 'The day', items: ['Ceremony', 'Cocktail hour', 'Reception'], note: 'Each event: room, time, what to expect. Unknown facts render as TODO(Tyler & Sara), never as prose.' },
      { kind: 'facts', label: 'Good to know', items: ['Dress code', 'Accessibility', 'Children', 'Photography'] },
      { kind: 'callout', label: 'Reply', action: { label: 'RSVP', to: 'rsvp', variant: 'primary' } },
    ],
  },
  caa: {
    status: 'draft',
    blocks: [
      { kind: 'masthead', title: 'Explore CAA', lede: 'The building, room by room', media: 'wide' },
      { kind: 'map', id: 'floorplan', label: 'Floor plan, with your table when you are signed in', pins: 6 },
      { kind: 'collection', label: 'Spaces', item: 'Space', count: 6, layout: 'grid', to: 'caa-space', media: true },
      { kind: 'prose', label: 'History, with sources', paragraphs: 2 },
    ],
  },
  'caa-space': {
    status: 'draft',
    blocks: [
      { kind: 'masthead', title: 'Space name', lede: 'Floor · what happens here', media: 'wide' },
      { kind: 'prose', label: 'History', paragraphs: 2, note: 'Every claim carries a source link (ADR-0011).' },
      { kind: 'facts', label: 'Look for this', items: ['Detail', 'Detail', 'Detail'] },
    ],
  },
  travel: {
    status: 'review',
    blocks: [
      { kind: 'masthead', title: 'Travel & Stay', lede: 'Getting to Chicago and where to sleep' },
      { kind: 'facts', label: 'Airports', items: ['Airport', 'Airport'] },
      { kind: 'callout', id: 'room-block', label: 'The room block', action: { label: 'Book the block', external: 'the hotel\'s booking page', variant: 'primary' }, note: 'Deadline and rate are facts from the planner; TODO until then.' },
      { kind: 'collection', label: 'Other hotels', item: 'Hotel', count: 4, layout: 'list' },
      { kind: 'prose', label: 'The neighbourhood and the weather in July', paragraphs: 2 },
      { kind: 'faq', label: 'Travel questions', questions: ['Do I need a car?', 'Is the venue step-free?', 'Where do I park?'] },
    ],
  },
  gifts: {
    status: 'review',
    blocks: [
      { kind: 'masthead', title: 'Gifts', lede: 'Help us with our next adventures' },
      { kind: 'collection', label: 'Registries', item: 'Registry', count: 2, layout: 'list' },
      { kind: 'collection', label: 'Funds, given person to person', item: 'Fund', count: 4, layout: 'grid', note: 'Zelle / Venmo / PayPal / Cash App / check (ADR-0013). Payment details only for invited guests.' },
    ],
  },
  photos: {
    status: 'draft',
    blocks: [
      { kind: 'masthead', title: 'Photos & Video', lede: 'Engagement, the weekend, and yours' },
      { kind: 'collection', label: 'Collections', item: 'Collection', count: 4, layout: 'grid', to: 'photo-collection', media: true },
      { kind: 'callout', label: 'Were you there?', action: { label: 'Add your photos', to: 'media-upload', variant: 'primary' } },
    ],
  },
  'photo-collection': {
    status: 'draft',
    blocks: [
      { kind: 'masthead', title: 'Collection name', lede: 'Credit · rights' },
      { kind: 'media', label: 'Photos', aspect: 'square', count: 12 },
    ],
  },
  ask: {
    status: 'draft',
    blocks: [
      { kind: 'masthead', title: 'Ask Us', lede: 'Answers from what we have published, with sources' },
      { kind: 'chat', label: 'Concierge', suggestions: ['What time does it start?', 'Where should I stay?', 'Is there parking?'], note: 'Every answer cites a page; "we don\'t know yet" is a valid answer.' },
    ],
  },
  credits: {
    status: 'draft',
    blocks: [
      { kind: 'masthead', title: 'Photo credits' },
      { kind: 'table', label: 'Every image', columns: ['Image', 'By', 'Licence', 'Where it appears'], rows: 6 },
    ],
  },
};
