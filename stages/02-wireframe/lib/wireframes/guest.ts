import type { WireframeSpec } from '../types';

export const GUEST: Record<string, WireframeSpec> = {
  weekend: {
    status: 'review',
    blocks: [
      { kind: 'masthead', title: 'Your Weekend', lede: 'Household name' },
      { kind: 'split', columns: [
        [
          { kind: 'tasks', id: 'rsvp-status', label: 'Your RSVP', tasks: [{ title: 'Who is coming', to: 'rsvp-step' }, { title: 'Meals', to: 'rsvp-step' }, { title: 'Dietary and access needs', to: 'rsvp-step' }] },
          { kind: 'facts', label: 'Your table', items: ['Table', 'Room', 'Seated with'] },
        ],
        [
          { kind: 'timeline', label: 'Your schedule', items: ['Welcome', 'Ceremony', 'Reception', 'Farewell'] },
          { kind: 'collection', label: 'For your trip', item: 'Link', count: 3, layout: 'list' },
        ],
      ] },
    ],
    notes: ['Signed-out visitors see "Find your invitation" instead of the household.'],
  },
  rsvp: {
    status: 'review',
    blocks: [
      { kind: 'masthead', title: 'RSVP', lede: 'Reply by the deadline (TODO)' },
      { kind: 'tasks', id: 'parts', label: 'Your reply, in parts', tasks: [
        { title: 'Who is coming', to: 'rsvp-step' },
        { title: 'Bringing a guest', to: 'rsvp-step' },
        { title: 'Meals', to: 'rsvp-step' },
        { title: 'Dietary and access needs', to: 'rsvp-step' },
      ], note: 'Parts open independently; each shows its own saved status.' },
    ],
  },
  'rsvp-step': {
    status: 'review',
    blocks: [
      { kind: 'masthead', title: 'Who is coming', lede: 'Tell us who is coming to each event on your invitation.' },
      { kind: 'form', id: 'attendance', label: 'Attendance', submit: 'Save', next: 'rsvp', fields: [
        { label: 'Guest one: ceremony', type: 'radio', options: ['Attending', 'Not attending'], required: true },
        { label: 'Guest one: reception', type: 'radio', options: ['Attending', 'Not attending'], required: true },
        { label: 'Guest two: ceremony', type: 'radio', options: ['Attending', 'Not attending'], required: true },
        { label: 'Guest two: reception', type: 'radio', options: ['Attending', 'Not attending'], required: true },
      ] },
    ],
    notes: ['The same template carries the other parts: a guest, meals, needs.'],
  },
  transport: {
    status: 'draft',
    blocks: [
      { kind: 'masthead', title: 'Transportation', lede: 'Getting to and around the venue' },
      { kind: 'tabs', label: 'Ways to arrive', tabs: [
        { title: 'Ride', blocks: [{ kind: 'callout', label: 'Your ride voucher', action: { label: 'Open in the ride app', external: 'the ride provider', variant: 'primary' } }] },
        { title: 'Transit', blocks: [{ kind: 'prose', label: 'Trains and buses to the venue', paragraphs: 1 }] },
        { title: 'Driving', blocks: [{ kind: 'facts', label: 'Valet and parking', items: ['Valet', 'Garage', 'Rates'] }] },
      ] },
      { kind: 'facts', label: 'Accessibility', items: ['Step-free entrance', 'Drop-off point', 'Lifts'] },
    ],
  },
  trip: {
    status: 'draft',
    blocks: [
      { kind: 'masthead', title: 'Your trip' },
      { kind: 'form', label: 'Travel details', submit: 'Save', fields: [
        { label: 'Arriving', type: 'date' },
        { label: 'Flight or train', type: 'text', hint: 'Optional; helps us if plans change' },
        { label: 'Leaving', type: 'date' },
        { label: 'Where you are staying', type: 'select', options: ['The room block', 'Another hotel', 'With friends'] },
      ] },
    ],
  },
  'media-upload': {
    status: 'draft',
    blocks: [
      { kind: 'masthead', title: 'Add photos', lede: 'From the weekend, at full size' },
      { kind: 'form', label: 'Upload', submit: 'Upload', next: 'media-mine', fields: [
        { label: 'Photos and videos', type: 'file', required: true },
        { label: 'Who may see them', type: 'radio', options: ['Everyone invited', 'Only Sara and Tyler'], required: true },
        { label: 'Caption', type: 'textarea' },
      ] },
    ],
  },
  'media-mine': {
    status: 'draft',
    blocks: [
      { kind: 'masthead', title: 'Your uploads' },
      { kind: 'collection', label: 'Uploads', item: 'Upload', count: 6, layout: 'grid', media: true, note: 'Each tile: visibility, and remove.' },
    ],
  },
  'media-search': {
    status: 'draft',
    blocks: [
      { kind: 'masthead', title: 'Find photos' },
      { kind: 'form', label: 'Search', submit: 'Search', fields: [{ label: 'Moment, place or person', type: 'search' }] },
      { kind: 'media', label: 'Results', aspect: 'square', count: 9 },
    ],
  },
};
