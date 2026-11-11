import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CodeCells } from '@/app/(auth)/_components/CodeCells';

const type = (el: HTMLInputElement, value: string) => {
  el.value = value;
  fireEvent.input(el);
};

describe('the six-digit code field', () => {
  it('is one labelled field over six boxes, each with a placeholder until its digit is typed', () => {
    render(
      <label>
        Six-digit code
        <CodeCells />
      </label>,
    );
    const input = screen.getByRole('textbox', { name: /Six-digit code/ }) as HTMLInputElement;
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    const cells = () => [...document.querySelectorAll('.auth-code__cell')].map((c) => c.textContent);
    expect(cells()).toEqual(['–', '–', '–', '–', '–', '–']);
    act(() => type(input, '12'));
    expect(cells()).toEqual(['1', '2', '–', '–', '–', '–']);
  });

  it('keeps digits only, even from a pasted code with a space, and stops at six', () => {
    const onComplete = vi.fn();
    render(<CodeCells onComplete={onComplete} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    act(() => type(input, '1a2 b'));
    expect(input.value).toBe('12');
    expect(onComplete).not.toHaveBeenCalled();
    act(() => type(input, '123 4567'));
    expect(input.value).toBe('123456');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('holds still while the code is checked, and starts empty again when told to', () => {
    const { rerender } = render(<CodeCells busy />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.getAttribute('aria-busy')).toBe('true');
    act(() => type(input, '123456'));
    rerender(<CodeCells resetKey={1} />);
    expect(input.value).toBe('');
    expect(input.readOnly).toBe(false);
    expect(document.activeElement).toBe(input);
  });
});
