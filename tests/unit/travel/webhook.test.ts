import { describe, expect, it } from 'vitest';
import { parseDuffelEvent, signDuffelPayload, verifyDuffelSignature } from '@/providers/flights';

const secret = 'whsec_unit_test_secret_value';
const body = JSON.stringify({
  id: 'evt_1',
  type: 'order.created',
  created_at: '2026-09-05T12:00:00Z',
  data: {
    object: {
      id: 'ord_1',
      booking_reference: 'ZX9K2L',
      metadata: { reference: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      slices: [{ origin: { iata_code: 'LAX' }, destination: { iata_code: 'ORD' }, segments: [{ origin: { iata_code: 'LAX' }, destination: { iata_code: 'ORD' }, departing_at: '2027-07-16T08:00:00', arriving_at: '2027-07-16T14:10:00', marketing_carrier: { name: 'United', iata_code: 'UA' }, marketing_carrier_flight_number: '1234' }] }],
    },
  },
});

describe('Duffel webhook signature', () => {
  const now = Date.parse('2026-09-05T12:00:00Z');
  const t = Math.floor(now / 1000);
  it('accepts a fresh, correctly signed payload and rejects everything else', () => {
    expect(verifyDuffelSignature(body, signDuffelPayload(secret, body, t), secret, now).ok).toBe(true);
    const cases: Array<[string | null, string | undefined, number, string]> = [
      [signDuffelPayload('wrong-secret-value-123', body, t), secret, now, 'auth'],
      [signDuffelPayload(secret, body + ' ', t), secret, now, 'auth'],
      [signDuffelPayload(secret, body, t - 600), secret, now, 'auth'],
      ['t=abc,v1=zzz', secret, now, 'auth'],
      ['nonsense', secret, now, 'auth'],
      [null, secret, now, 'auth'],
      [signDuffelPayload(secret, body, t), undefined, now, 'unconfigured'],
    ];
    for (const [header, sec, at, cls] of cases) {
      const r = verifyDuffelSignature(body, header, sec, at);
      expect(!r.ok && r.error.class, String(header)).toBe(cls);
    }
  });

  it('parses order events into a provider-neutral booking event and rejects unknown shapes', () => {
    const r = parseDuffelEvent(JSON.parse(body));
    expect(r.ok && r.value).toMatchObject({
      type: 'order.created',
      orderId: 'ord_1',
      bookingReference: 'ZX9K2L',
      reference: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      slices: [{ origin: 'LAX', destination: 'ORD', carrier: 'United', flightNumber: 'UA1234', departAt: '2027-07-16T08:00:00' }],
    });
    expect(parseDuffelEvent({ hello: 'world' }).ok).toBe(false);
    expect(parseDuffelEvent(null).ok).toBe(false);
    const noRef = parseDuffelEvent({ id: 'e', type: 'order.updated', data: { object: { id: 'o' } } });
    expect(noRef.ok && noRef.value.reference).toBeUndefined();
  });
});
