import { describe, expect, it } from 'vitest';
import { parseMqttTimestamp } from '../src/mqtt/ingestion-helpers.js';

describe('parseMqttTimestamp helper', () => {
  it('returns null date for omitted ts and monotonic uptime numbers < 1e9', () => {
    expect(parseMqttTimestamp(undefined)).toEqual({ ok: true, date: null });
    expect(parseMqttTimestamp(0)).toEqual({ ok: true, date: null });
    expect(parseMqttTimestamp(45120)).toEqual({ ok: true, date: null });
    expect(parseMqttTimestamp(999_999_999)).toEqual({ ok: true, date: null });
  });

  it('parses finite epoch seconds (>= 1e9) and epoch milliseconds (>= 1e12)', () => {
    const secResult = parseMqttTimestamp(1795089600);
    expect(secResult.ok).toBe(true);
    if (secResult.ok) {
      expect(secResult.date?.toISOString()).toBe('2026-11-19T12:00:00.000Z');
    }

    const msResult = parseMqttTimestamp(1795089605123);
    expect(msResult.ok).toBe(true);
    if (msResult.ok) {
      expect(msResult.date?.toISOString()).toBe('2026-11-19T12:00:05.123Z');
    }
  });

  it('parses strict ISO-8601 date and datetime strings', () => {
    const utcResult = parseMqttTimestamp('2026-11-19T12:00:00Z');
    expect(utcResult.ok).toBe(true);
    if (utcResult.ok) {
      expect(utcResult.date?.toISOString()).toBe('2026-11-19T12:00:00.000Z');
    }

    const offsetResult = parseMqttTimestamp(' 2026-11-19t14:00:00+02:00 ');
    expect(offsetResult.ok).toBe(true);
    if (offsetResult.ok) {
      expect(offsetResult.date?.toISOString()).toBe('2026-11-19T12:00:00.000Z');
    }

    const dateOnlyResult = parseMqttTimestamp('2026-11-19');
    expect(dateOnlyResult.ok).toBe(true);
    if (dateOnlyResult.ok) {
      expect(dateOnlyResult.date?.toISOString()).toBe('2026-11-19T00:00:00.000Z');
    }
  });

  it('rejects invalid ISO strings and negative, non-finite, or out-of-range numbers', () => {
    const invalidInputs: Array<string | number> = [
      '',
      '   ',
      'not-a-timestamp',
      '2026-02-30T12:00:00Z',
      '2026-13-45T00:00:00Z',
      '12345',
      '11/19/2026',
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      1e20,
    ];

    for (const input of invalidInputs) {
      const result = parseMqttTimestamp(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.length).toBeGreaterThan(0);
      }
    }
  });
});
