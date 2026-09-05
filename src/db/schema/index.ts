/**
 * Level-03 (foundation) tables. Feature swarms add their own files here and
 * re-export them below; never edit another swarm's table file.
 */
export * from './site';
export * from './flags';
export * from './audit';
export * from './jobs';
export * from './metrics';
export * from './content';
export * from './knowledge';
export * from './idempotency';
export * from './rateLimits';
export * from './auth';
// Level 06 owns guests/households/invitations. Swarm E built against a stub of this file
// (`guests.stub.ts`, deleted at integration); its foreign keys now resolve against the real one.
export * from './guests';
// Level 07: events, RSVP, seating.
export * from './events';
export * from './rsvp';
export * from './seating';
// Level 08: travel profiles, itinerary items, hotel recommendations, travel links.
export * from './travel';
// Level 09: transport, gifts, reservations, external actions.
export * from './transport';
export * from './gifts';
export * from './reservations';
export * from './external';
