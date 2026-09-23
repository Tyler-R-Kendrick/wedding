import type { WireframeSpec } from '../types';

/** Only the admin pages that differ from the derived list-and-filter template are drawn here. */
export const ADMIN: Record<string, WireframeSpec> = {
  admin: {
    status: 'draft',
    blocks: [
      { kind: 'masthead', title: 'Admin', lede: 'Current state · days to go' },
      { kind: 'facts', label: 'Today', items: ['Replies in', 'Awaiting reply', 'Uploads to review', 'Failed jobs'] },
      { kind: 'collection', label: 'Tools', item: 'Tool', count: 8, layout: 'grid' },
    ],
  },
  'admin-lifecycle': {
    status: 'draft',
    blocks: [
      { kind: 'masthead', title: 'Lifecycle', lede: 'Current state' },
      { kind: 'timeline', label: 'States', items: ['Teaser', 'Save the date', 'Invitations', 'RSVP open', 'RSVP closed', 'Week of', 'The day', 'After', 'Archive'] },
      { kind: 'form', label: 'Move to', submit: 'Move', fields: [{ label: 'State', type: 'select', options: ['Next state', 'Previous state'] }] },
    ],
  },
  'admin-rsvp': {
    status: 'draft',
    blocks: [
      { kind: 'masthead', title: 'RSVPs' },
      { kind: 'facts', label: 'Counts', items: ['Attending', 'Declined', 'Waiting', 'Meals'] },
      { kind: 'table', label: 'Replies', columns: ['Household', 'Attending', 'Meals', 'Needs', 'Replied'], rows: 8, filters: ['Event', 'Status'] },
    ],
  },
};
