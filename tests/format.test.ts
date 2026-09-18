import { describe, expect, it } from 'vitest';
import { formatAgo } from '../src/popup/format';

describe('formatAgo', () => {
  const now = Date.parse('2026-09-18T12:00:00Z');
  it.each([
    [10_000, 'just now'],
    [2 * 60_000, '2 minutes ago'],
    [60 * 60_000, '1 hour ago'],
    [5 * 60 * 60_000, '5 hours ago'],
    [26 * 60 * 60_000, '1 day ago'],
    [3 * 24 * 60 * 60_000, '3 days ago'],
  ])('renders %i ms ago', (delta, expected) => {
    expect(formatAgo(now - delta, now)).toBe(expected);
  });
});
