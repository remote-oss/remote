import {deepStrictEqual} from 'node:assert';
import {
  firstCheckOutcomeOf,
  type QueryResult,
  secondCheckOutcomeOf,
} from '../../src/engine/check-outcome.ts';
import type {Executable} from '../../src/engine/executable.ts';

const SPAWN: Executable = {kind: 'spawn', file: 'docker', written: 'docker'};

const PASSING_REPLY = '{"Server":{"ApiVersion":"1.51"}}';

/** A query that ran and exited with `status`, printing `stderr`. */
function exited(
  status: number | undefined,
  stderr = '',
  stdout = '',
  timedOut = false,
): QueryResult {
  return {kind: 'ran', status, stdout, stderr, timedOut};
}

const GOOD = exited(0);
const GOOD_STRUCTURED = exited(0, '', PASSING_REPLY);

describe('the classification of the first check', () => {
  for (const [name, executable, queries, expected] of [
    ['no executable', {kind: 'notFound', written: 'x/y'}, [], 'notFound'],
    [
      'a spawn that fails with ENOENT',
      SPAWN,
      [{kind: 'failed', detail: 'spawn dk ENOENT'}],
      'notFound',
    ],
    [
      'a spawn that fails with EACCES',
      SPAWN,
      [{kind: 'failed', detail: 'spawn dk EACCES'}],
      'engineError',
    ],
    [
      'a query that timed out',
      SPAWN,
      [exited(undefined, '', '', true)],
      'engineError',
    ],
    [
      'a timed-out query that exited 0',
      SPAWN,
      [exited(0, '', '', true)],
      'engineError',
    ],
    [
      'permission denied on stderr',
      SPAWN,
      [exited(1, 'permission denied while trying')],
      'permission',
    ],
    [
      'PERMISSION DENIED in capitals',
      SPAWN,
      [exited(1, 'PERMISSION DENIED')],
      'permission',
    ],
    [
      'both texts on stderr',
      SPAWN,
      [exited(1, 'permission denied; not found')],
      'permission',
    ],
    [
      'F-0201 AC-47, not found on stderr',
      SPAWN,
      [exited(1, 'context not found')],
      'notFound',
    ],
    ['notfound on stderr', SPAWN, [exited(1, 'notfound')], 'notFound'],
    [
      'not found on stdout only',
      SPAWN,
      [exited(1, '', 'not found')],
      'engineError',
    ],
    ['a signal exit', SPAWN, [exited(undefined)], 'engineError'],
    [
      'an unreachable engine',
      SPAWN,
      [
        GOOD,
        exited(
          1,
          'failed to connect to the docker API at unix:///nonexistent.sock; check if the path is correct and if the daemon is running: dial unix /nonexistent.sock: connect: no such file or directory',
          '{"Client":{},"Server":null}',
        ),
      ],
      'engineError',
    ],
    [
      'F-0201 AC-47, a missing context',
      SPAWN,
      [
        GOOD,
        exited(
          1,
          'Failed to initialize: unable to resolve docker endpoint: context "nosuch": context not found: x',
        ),
      ],
      'notFound',
    ],
    [
      'a server below the minimum',
      SPAWN,
      [GOOD, exited(0, '', '{"Server":{"ApiVersion":"1.30"}}')],
      'tooOld',
    ],
    ['two exits of 0', SPAWN, [GOOD, GOOD_STRUCTURED], 'passed'],
    [
      'two exits of 0 and an unreadable reply',
      SPAWN,
      [GOOD, exited(0, '', 'x')],
      'passed',
    ],
  ] as ReadonlyArray<[string, Executable, QueryResult[], string]>) {
    it(`F-0201 BR-3: ${name} is ${expected}`, () => {
      deepStrictEqual(firstCheckOutcomeOf(executable, queries), expected);
    });
  }
});

describe('the classification of the second check', () => {
  for (const [name, executable, query, expected] of [
    ['an exit of 0', SPAWN, exited(0), {kind: 'passed'}],
    [
      'no executable',
      {kind: 'notFound', written: 'x/y'},
      exited(0),
      {kind: 'failed', detail: 'S339'},
    ],
    [
      'a spawn failure',
      SPAWN,
      {kind: 'failed', detail: 'spawn dk EACCES'},
      {kind: 'failed', detail: 'S339'},
    ],
    [
      'permission denied',
      SPAWN,
      exited(1, 'permission denied while trying to connect to the docker API'),
      {kind: 'failed', detail: 'S104'},
    ],
    [
      'another exit',
      SPAWN,
      exited(1, 'boom'),
      {kind: 'failed', detail: 'S144'},
    ],
    [
      'a timeout',
      SPAWN,
      exited(undefined, '', '', true),
      {kind: 'failed', detail: 'S144'},
    ],
  ] as ReadonlyArray<[string, Executable, QueryResult, unknown]>) {
    it(`F-0201 5.0 step 5: ${name} is ${JSON.stringify(expected)}`, () => {
      deepStrictEqual(secondCheckOutcomeOf(executable, query), expected);
    });
  }
});
