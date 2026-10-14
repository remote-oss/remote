import {deepStrictEqual} from 'node:assert';
import type {Failed} from 'lib-authority';
import {
  cancelled,
  containerGone,
  containerSetupFailed,
  containerUnusable,
  engineCheckFailed,
  malformedAuthority,
  noServerSource,
  relayFailed,
  remoteEngine,
  requirementsNotMet,
  serverFailed,
  transportLost,
  unsupportedPlatform,
} from '../../src/connect/failures.ts';

/** The kind, the reason and the three flags of a failure. */
function shape(failed: Failed): unknown[] {
  return [
    failed.kind,
    failed.reason,
    failed.retryable,
    failed.silent,
    failed.userAlreadyNotified,
  ];
}

describe('the failures of the container connector (card containers-08)', () => {
  it('contracts §2: rows 1 to 5 of the table', () => {
    deepStrictEqual(
      [
        shape(malformedAuthority()),
        shape(remoteEngine()),
        shape(engineCheckFailed('S104')),
        shape(containerUnusable()),
        shape(containerSetupFailed()),
      ],
      [
        ['malformedAuthority', undefined, false, false, false],
        ['remoteEngine', {id: 'S034'}, false, false, false],
        ['engineCheckFailed', {id: 'S104'}, false, false, false],
        ['containerUnusable', {id: 'S034'}, false, false, false],
        ['containerSetupFailed', {id: 'S034'}, false, false, false],
      ],
    );
  });

  it('F-0410 AC-11, AC-12: row 5 gives S018 for a refused mount, S019 for a port in use and S034 otherwise (card containers-11)', () => {
    deepStrictEqual(
      [
        containerSetupFailed('invalidMount').reason,
        containerSetupFailed('portAllocated').reason,
        containerSetupFailed(undefined).reason,
      ],
      [{id: 'S018'}, {id: 'S019'}, {id: 'S034'}],
    );
  });

  it('contracts §2: rows 6 to 10 of the table', () => {
    deepStrictEqual(
      [
        shape(noServerSource('VSCodium')),
        shape(unsupportedPlatform('S031', 'armv7l')),
        shape(requirementsNotMet('missing libstdc++')),
        shape(serverFailed()),
        shape(relayFailed()),
      ],
      [
        [
          'noServerSource',
          {
            id: 'noServerSource',
            values: ['remote-oss.remote-containers', 'VSCodium'],
          },
          false,
          false,
          false,
        ],
        [
          'unsupportedPlatform',
          {id: 'S031', values: ['armv7l']},
          false,
          false,
          false,
        ],
        [
          'requirementsNotMet',
          {text: 'missing libstdc++'},
          false,
          false,
          false,
        ],
        ['serverFailed', {id: 'S034'}, false, false, false],
        ['relayFailed', {id: 'S034'}, false, false, false],
      ],
    );
  });

  it('contracts §2: rows 11 to 13 of the table', () => {
    deepStrictEqual(
      [shape(cancelled()), shape(containerGone()), shape(transportLost())],
      [
        ['cancelled', undefined, false, true, false],
        ['containerGone', undefined, false, true, false],
        ['transportLost', undefined, true, false, false],
      ],
    );
  });

  it('contracts §2: no failure has a hint, and none has a diagnostic of its own', () => {
    deepStrictEqual(
      [
        malformedAuthority(),
        engineCheckFailed('S339'),
        unsupportedPlatform('S359', 'x'),
        transportLost(),
      ].map(failed => [failed.hints, failed.diagnostics]),
      [
        [[], []],
        [[], []],
        [[], []],
        [[], []],
      ],
    );
  });
});
