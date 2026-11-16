import { describe, expect, it } from 'vitest';
import { buildSiteDetails, sameText, withValue, type SiteDetailsInput } from '@/domain/site-details';

const base = (over: Partial<SiteDetailsInput> = {}): SiteDetailsInput => ({
  site: { weddingDate: '2027-07-17', venueName: 'Chicago Athletic Association Hotel', venueAddress: '12 S Michigan Ave, Chicago, IL 60603', venueUrl: null },
  rsvp: { mode: 'auto', deadlineAt: null, note: 'Deadline TODO' },
  events: [{ id: 'e1', name: 'Ceremony', dateIso: '2027-07-17', startsAt: null, endsAt: null, room: null, dressCode: null }],
  block: { rateText: '$331–371 per night', checkIn: '2027-07-16', checkOut: '2027-07-18', cutoff: '2027-06-15', code: 'G-TEST', placeholder: false },
  fields: { 'valet.entrance': { id: 'f1', value: '71 E Madison' }, 'valet.event-rate': { id: 'f2', value: '$84/night' } },
  code: { weddingDate: '2027-07-17', venueName: 'Chicago Athletic Association Hotel', venueAddress: '12 S. Michigan Avenue, Chicago, IL 60603', valetEntrance: '71 E. Madison St', valetNote: 'Hotel valet 24 hours at 71 E. Madison St, $84 per vehicle, per night.', blockCheckIn: '2027-07-16', blockCheckOut: '2027-07-18', blockCutoff: '2027-06-15', blockRate: '$331–371 per night' },
  format: { day: (iso) => `day(${iso})`, instant: (iso) => `at(${iso})`, window: (s, e) => `${s}..${e}` },
  ...over,
});
const fact = (facts: ReturnType<typeof buildSiteDetails>, key: string) => facts.find((f) => f.key === key)!;

describe('the shared facts of the site, in one list', () => {
  it('reads an address the way a person does, so two spellings of one address agree', () => {
    expect(sameText('12 S. Michigan Avenue, Chicago, IL 60603', '12 S Michigan Ave, Chicago, IL 60603')).toBe(true);
    expect(sameText('12 S Michigan Ave', '14 S Michigan Ave')).toBe(false);
  });

  it('marks what is decided, what is not, and nothing as out of step while every copy agrees', () => {
    const facts = buildSiteDetails(base());
    expect(fact(facts, 'wedding.date')).toMatchObject({ value: 'day(2027-07-17)', state: 'set', copies: [] });
    expect(fact(facts, 'venue.address').state).toBe('set');
    expect(fact(facts, 'venue.url').state).toBe('todo');
    expect(fact(facts, 'rsvp.deadline')).toMatchObject({ value: null, state: 'todo' });
    expect(fact(facts, 'event.e1')).toMatchObject({ state: 'todo', value: 'day(2027-07-17). Still to decide: time, room, dress code' });
    expect(fact(facts, 'valet.event-rate').state).toBe('set');
    expect(facts.filter((f) => f.state === 'differs')).toEqual([]);
  });

  it('every fact names where it shows and how it is changed', () => {
    for (const f of buildSiteDetails(base())) {
      expect(f.shownOn.length, f.key).toBeGreaterThan(0);
      expect(['here', 'screen'], f.key).toContain(f.edit.kind);
    }
  });

  it('a date changed in the record is out of step with the copy the code keeps, and says where that copy is', () => {
    const facts = buildSiteDetails(base({ site: { ...base().site, weddingDate: '2027-07-24' }, events: [{ id: 'e1', name: 'Ceremony', dateIso: '2027-07-17', startsAt: null, endsAt: null, room: null, dressCode: null }] }));
    const date = fact(facts, 'wedding.date');
    expect(date.state).toBe('differs');
    expect(date.copies.map((c) => c.value)).toEqual(['day(2027-07-17)', 'day(2027-07-17)']);
    expect(date.copies[0]!.where).toContain('src/contracts/lifecycle.ts');
    expect(date.copies[1]!.where).toContain('Ceremony');
  });

  it('a valet rate changed in its record is flagged against the sentence the travel pages print', () => {
    const facts = buildSiteDetails(base({ fields: { 'valet.entrance': { id: 'f1', value: '71 E Madison' }, 'valet.event-rate': { id: 'f2', value: '$90/night' } } }));
    expect(fact(facts, 'valet.event-rate')).toMatchObject({ state: 'differs', value: '$90/night' });
    expect(fact(facts, 'valet.entrance').state).toBe('set');
  });

  it('a room block edited away from the dates the code assumes is flagged', () => {
    const facts = buildSiteDetails(base({ block: { ...base().block!, checkIn: '2027-07-15', cutoff: '2027-06-20' } }));
    expect(fact(facts, 'block.nights').state).toBe('differs');
    expect(fact(facts, 'block.cutoff').state).toBe('differs');
    expect(fact(facts, 'block.rate').state).toBe('set');
  });

  it('an edit made here carries the call that saves it: the capability, its other arguments, and where the value goes', () => {
    const facts = buildSiteDetails(base());
    expect(fact(facts, 'wedding.date').edit).toMatchObject({ kind: 'here', input: 'date', capability: 'admin_update_site_details', field: 'weddingDate', raw: '2027-07-17' });
    const deadline = fact(facts, 'rsvp.deadline').edit;
    expect(deadline).toMatchObject({ kind: 'here', capability: 'admin_set_rsvp_window', base: { mode: 'auto', note: 'Deadline TODO' }, field: 'deadlineAt' });
    const valet = fact(facts, 'valet.event-rate').edit;
    expect(valet).toMatchObject({ kind: 'here', capability: 'save_content_record', field: 'data.value' });
    if (valet.kind !== 'here') throw new Error('expected an in-place edit');
    expect(withValue(valet.base, valet.field, '$90/night')).toEqual({ table: 'operational_fields', id: 'f2', merge: true, data: { value: '$90/night' } });
    // The registry's own object is not written through.
    expect(valet.base).toEqual({ table: 'operational_fields', id: 'f2', merge: true, data: {} });
  });
});
