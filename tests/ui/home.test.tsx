import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HomePage from '@/app/page';

describe('home placeholder', () => {
  it('renders the names, the date, and landmarks', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sara + Tyler');
    expect(screen.getByRole('main').textContent).toContain('Chicago');
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe('2027-07-17');
  });
});
