import { describe, expect, it } from 'vitest';
import { loadFaultRegistry, parseFaultRegistry } from '../src/spec/fault-registry.js';

describe('fault registry', () => {
  it('parses a valid flat JSON array of fault entries', () => {
    const raw = [
      {
        error_code: 'ERR_FIBER_SNAP',
        title: 'Fiber Snap Detected',
        symptoms: 'Tension dropped to zero during active winding.',
        fix_steps_md: '1. Press Pause.\n2. Re-thread fiberglass strand.\n3. Press Start.',
      },
    ];

    const entries = parseFaultRegistry(raw);

    expect(entries).toEqual([
      {
        error_code: 'ERR_FIBER_SNAP',
        title: 'Fiber Snap Detected',
        symptoms: 'Tension dropped to zero during active winding.',
        fix_steps_md: '1. Press Pause.\n2. Re-thread fiberglass strand.\n3. Press Start.',
      },
    ]);
  });

  it('rejects non-array, empty-array, missing fields, and whitespace-only strings', () => {
    expect(() => parseFaultRegistry({})).toThrow();
    expect(() => parseFaultRegistry([])).toThrow();
    expect(() =>
      parseFaultRegistry([{ error_code: 'ERR_FIBER_SNAP', title: 'Snap', symptoms: 'Zero tension' }]),
    ).toThrow();
    expect(() =>
      parseFaultRegistry([
        {
          error_code: 'ERR_FIBER_SNAP',
          title: '   ',
          symptoms: 'Zero tension',
          fix_steps_md: '1. Restart.',
        },
      ]),
    ).toThrow();
  });

  it('rejects malformed error_code values that are not valid uppercase C++ enum identifiers', () => {
    for (const badCode of ['err_fiber_snap', 'ERR FIBER', '1_ERR', 'ERR-SNAP', 'ERR__SNAP', 'ERR_', '']) {
      expect(() =>
        parseFaultRegistry([
          {
            error_code: badCode,
            title: 'Fault',
            symptoms: 'Stopped',
            fix_steps_md: '1. Check machine.',
          },
        ]),
      ).toThrow();
    }
  });

  it('rejects entries with unexpected or nested fields', () => {
    expect(() =>
      parseFaultRegistry([
        {
          error_code: 'ERR_FIBER_SNAP',
          title: 'Fault',
          symptoms: 'Stopped',
          fix_steps_md: '1. Check machine.',
          nested: { bad: true },
        },
      ]),
    ).toThrow();
  });

  it('rejects duplicate error_code keys and names the duplicate code', () => {
    expect(() =>
      parseFaultRegistry([
        {
          error_code: 'ERR_BOBBIN_JAM',
          title: 'Bobbin Jam 1',
          symptoms: 'Motor stalled.',
          fix_steps_md: '1. Clear jam.',
        },
        {
          error_code: 'ERR_BOBBIN_JAM',
          title: 'Bobbin Jam 2',
          symptoms: 'Motor stalled again.',
          fix_steps_md: '1. Inspect spindle.',
        },
      ]),
    ).toThrow(/ERR_BOBBIN_JAM/);
  });

  it('loads spec/error_codes.json with all initial winding-room faults and numbered markdown steps', () => {
    const entries = loadFaultRegistry();
    const codes = entries.map((entry) => entry.error_code);

    expect(codes).toEqual(
      expect.arrayContaining([
        'ERR_FIBER_SNAP',
        'ERR_TENSION_FAULT',
        'ERR_SUBSYSTEM_TIMEOUT',
        'ERR_BOBBIN_JAM',
        'ERR_BROWNOUT_RESET',
        'ERR_WATCHDOG_RESET',
      ]),
    );

    for (const entry of entries) {
      expect(entry.fix_steps_md).toMatch(/1\.\s+/);
    }
  });
});
