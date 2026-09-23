import { describe, expect, it } from 'vitest';
import { PAGES } from '@wedding/sitemap';
import { fingerprint, wireframeFor } from '@wedding/wireframe';
import { board, readSignoffs, validateSignoffs, type SignoffFile } from '../../../scripts/stages/board';

describe('the promotion board', () => {
  it('the committed sign-off ledger is valid', () => {
    expect(validateSignoffs(readSignoffs())).toEqual([]);
  });

  it('has a row for every sitemap page', () => {
    expect(board({ signoffs: [] }).map((r) => r.page.id)).toEqual(PAGES.map((p) => p.id));
  });

  it('a sign-off holds while its wireframe is unchanged, and goes stale when it changes', () => {
    const current = fingerprint(wireframeFor('rsvp'));
    const ledger: SignoffFile = {
      signoffs: [
        { page: 'rsvp', stage: 'skeleton', by: 'Sara', on: '2026-09-01', wireframe: current },
        { page: 'rsvp', stage: 'placeholder', by: 'Tyler', on: '2026-09-02', wireframe: '00000000' },
      ],
    };
    const row = board(ledger).find((r) => r.page.id === 'rsvp')!;
    expect(row.approvals.skeleton).toMatchObject({ state: 'signed', by: 'Sara' });
    expect(row.approvals.placeholder).toMatchObject({ state: 'stale', by: 'Tyler' });
    expect(row.approvals.wireframe).toEqual({ state: 'open' });
  });

  it('the latest sign-off per page and stage wins', () => {
    const fp = fingerprint(wireframeFor('home'));
    const row = board({
      signoffs: [
        { page: 'home', stage: 'wireframe', by: 'Sara', on: '2026-09-10', wireframe: fp },
        { page: 'home', stage: 'wireframe', by: 'Tyler', on: '2026-08-01', wireframe: '00000000' },
      ],
    }).find((r) => r.page.id === 'home')!;
    expect(row.approvals.wireframe).toMatchObject({ state: 'signed', by: 'Sara' });
  });

  it('rejects entries the board could not place', () => {
    const errors = validateSignoffs({ signoffs: [{ page: 'nope', stage: 'real' as never, by: '', on: 'soon', wireframe: 'xyz' }] });
    expect(errors).toHaveLength(5);
  });
});
