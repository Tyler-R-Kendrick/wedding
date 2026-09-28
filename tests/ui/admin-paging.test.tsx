import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageLinks, paged } from '@/components/admin/flow/paging';

/*
 * Paging under a long admin list: the links keep the list's search, drop the one-time notices and
 * the old page, and land on the list's own section.
 */
describe('PageLinks', () => {
  const rows = Array.from({ length: 120 }, (_, i) => i);

  it('keeps the search and the section, and drops notices and the old page', () => {
    render(<PageLinks paging={paged(rows, '2')} path="/admin/guests" params={{ q: 'ada', merged: 'on', ok: 'Saved.', error: undefined, page: '2' }} noun="guests" anchor="guests" />);
    expect(screen.getByText('51–100 of 120 guests')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Previous 50' }).getAttribute('href')).toBe('/admin/guests?q=ada&merged=on#guests');
    expect(screen.getByRole('link', { name: 'Next 20' }).getAttribute('href')).toBe('/admin/guests?q=ada&merged=on&page=3#guests');
    expect(screen.getByRole('navigation', { name: 'Pages of guests' })).toBeTruthy();
  });

  it('says nothing when the list fits on one page', () => {
    const { container } = render(<PageLinks paging={paged(rows.slice(0, 50), undefined)} path="/admin/guests" params={{}} noun="guests" />);
    expect(container.innerHTML).toBe('');
  });
});
