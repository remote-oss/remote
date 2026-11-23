import {deepStrictEqual} from 'node:assert';
import {
  ATTRIBUTES_BOUND_MILLISECONDS,
  attributesInEffect,
  untilAttributesInEffect,
} from '../../src/ports/attributes-in-effect.ts';

interface Window {
  effective: Record<string, unknown>;
  listeners: Set<() => void>;
  timers: Map<() => void, number>;
  change(next: Record<string, unknown>): void;
  elapse(): void;
}

/** A window whose settings and timers the test drives. */
function windowOf(effective: Record<string, unknown> = {}): Window {
  const window: Window = {
    effective,
    listeners: new Set(),
    timers: new Map(),
    change: next => {
      window.effective = next;
      for (const listener of [...window.listeners]) {
        listener();
      }
    },
    elapse: () => {
      for (const timer of [...window.timers.keys()]) {
        timer();
      }
    },
  };
  return window;
}

/** The wait over `window`. */
function waitOn(
  written: Record<string, unknown>,
  window: Window,
): Promise<string> {
  return untilAttributesInEffect(
    written,
    {
      effective: key => window.effective[key],
      onChanged: listener => {
        window.listeners.add(listener);
        return {
          dispose: () => {
            window.listeners.delete(listener);
          },
        };
      },
    },
    {
      setTimer: (milliseconds, callback) => {
        window.timers.set(callback, milliseconds);
        return () => {
          window.timers.delete(callback);
        };
      },
    },
  );
}

const WRITTEN = {
  'remote.portsAttributes': {
    '3000': {label: 'FromCust'},
    '3001': {label: 'DCOnly'},
  },
  'remote.otherPortsAttributes': {label: 'CustOther'},
};

describe('the declared forwards wait for the port attributes (card #2619)', () => {
  it('F-1101 BR-10: nothing written is nothing to wait for', async () => {
    const window = windowOf();
    deepStrictEqual(
      [await waitOn({}, window), window.listeners.size, window.timers.size],
      ['none', 0, 0],
    );
  });

  it('F-1101 BR-10: attributes already in effect end the wait at once', async () => {
    const window = windowOf({...WRITTEN});
    deepStrictEqual(
      [await waitOn(WRITTEN, window), window.listeners.size],
      ['inEffect', 0],
    );
  });

  it('F-1101 BR-10, AC-35: the wait ends at the change that brings every written setting, and removes its listener and timer', async () => {
    const window = windowOf({
      'remote.portsAttributes': {'443': {protocol: 'https'}},
    });
    const waiting = waitOn(WRITTEN, window);
    const bound = [...window.timers.values()];
    window.change({
      'remote.portsAttributes': {
        '443': {protocol: 'https'},
        '3000': {label: 'FromCust'},
        '3001': {label: 'DCOnly'},
      },
    });
    const afterFirst = window.listeners.size;
    window.change({
      'remote.portsAttributes': {
        '443': {protocol: 'https'},
        '3000': {label: 'FromCust'},
        '3001': {label: 'DCOnly'},
      },
      'remote.otherPortsAttributes': {label: 'CustOther'},
    });
    deepStrictEqual(
      [
        bound,
        afterFirst,
        await waiting,
        window.listeners.size,
        window.timers.size,
      ],
      [[ATTRIBUTES_BOUND_MILLISECONDS], 1, 'inEffect', 0, 0],
    );
  });

  it('F-1101 BR-10: the bound ends a wait for settings that never arrive, and removes the listener', async () => {
    const window = windowOf();
    const waiting = waitOn(WRITTEN, window);
    window.elapse();
    deepStrictEqual(
      [await waiting, window.listeners.size, window.timers.size],
      ['bound', 0, 0],
    );
  });

  it('F-1101 BR-23: an effective value that the user’s own settings add to still holds what was written', () => {
    deepStrictEqual(
      attributesInEffect(WRITTEN, {
        effective: key =>
          key === 'remote.portsAttributes'
            ? {
                '3000': {label: 'FromCust', onAutoForward: 'notify'},
                '3001': {label: 'DCOnly'},
                '4000': {label: 'UserOnly'},
              }
            : {label: 'CustOther', protocol: 'https'},
      }),
      true,
    );
  });

  it('F-1101 BR-24: a port whose value differs from what was written is not in effect yet', () => {
    deepStrictEqual(
      [
        attributesInEffect(WRITTEN, {
          effective: key =>
            key === 'remote.portsAttributes'
              ? {'3000': {label: 'FromDC'}, '3001': {label: 'DCOnly'}}
              : {label: 'CustOther'},
        }),
        attributesInEffect(WRITTEN, {
          effective: key =>
            key === 'remote.portsAttributes' ? 'not an object' : undefined,
        }),
        attributesInEffect(
          {'remote.portsAttributes': {'3000': {elevateIfNeeded: true}}},
          {effective: () => ({'3000': {elevateIfNeeded: false}})},
        ),
      ],
      [false, false, false],
    );
  });
});
