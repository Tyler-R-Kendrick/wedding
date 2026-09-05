import { describe, expect, it } from 'vitest';
import { REDACTED, redactForStorage, redactPii } from '@/ai/redact';

describe('concierge redaction', () => {
  it('removes the contact details guests type into a chat box', () => {
    const text = 'I am sara.example@mail.com, call me on (312) 555-0142, we are at 1200 North Lake Shore Drive.';
    const redacted = redactPii(text);
    expect(redacted).not.toContain('sara.example@mail.com');
    expect(redacted).not.toContain('555-0142');
    expect(redacted).not.toContain('Lake Shore Drive');
    expect(redacted.split(REDACTED).length - 1).toBeGreaterThanOrEqual(3);
  });

  it('removes query strings, which carry tokens', () => {
    expect(redactPii('see https://example.com/x?token=abc123')).not.toContain('token=abc123');
  });

  it('keeps wedding facts', () => {
    expect(redactPii('The wedding is on July 17, 2027 at the Chicago Athletic Association Hotel.')).toContain('Chicago Athletic Association Hotel');
  });

  it('collapses whitespace and caps length for storage', () => {
    expect(redactForStorage('a\n\n  b', 100)).toBe('a b');
    expect(redactForStorage('abcdefghij', 5)).toBe('abcd…');
  });
});
