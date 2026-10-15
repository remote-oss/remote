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

  it('F-0201 AC-47: not found on stderr is notFound', () => {
    deepStrictEqual(
      firstCheckOutcomeOf(SPAWN, [exited(1, 'context not found')]),
      'notFound',
    );
  });

  it('F-0201 AC-47: a missing context is notFound', () => {
    deepStrictEqual(
      firstCheckOutcomeOf(SPAWN, [
        GOOD,
        exited(
          1,
          'Failed to initialize: unable to resolve docker endpoint: context "nosuch": context not found: x',
        ),
      ]),
      'notFound',
    );
  });
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

/** The stderr forms of card containers-10 §2, as the pinned Docker 29.9.0 wrote them. */
const FORM_3 =
  'failed to connect to the docker API at unix:///nonexistent.sock; check if the path is correct and if the daemon is running: dial unix /nonexistent.sock: connect: no such file or directory';
const FORM_5 =
  'permission denied while trying to connect to the docker API at unix:///home/u/.docker/root.sock';
const FORM_6_WARNING =
  'WARNING: Error loading config file: open /home/u/.docker/config.json: permission denied';
const FORM_11 =
  'Failed to initialize: unable to resolve docker endpoint: context "nope": context not found: open /home/u/.docker/contexts/meta/ab12/meta.json: no such file or directory';
const FORM_7 = [
  'Error response from daemon: <!DOCTYPE HTML>',
  '<html lang="en">',
  '    <head>',
  '        <title>Error response</title>',
  '    </head>',
  '    <body>',
  '        <h1>Error response</h1>',
  '        <p>Error code: 404</p>',
  '        <p>Message: File not found.</p>',
  '    </body>',
  '</html>',
].join('\n');
const FORM_8_START =
  'error during connect: Get "http://docker.example.com/v1.56/version": command [ssh -l nosuchuser0201 -o ConnectTimeout=30 -T -- build.example docker system dial-stdio] has exited with exit status 255, make sure the URL is valid, and Docker 18.09 or later is installed on the remote host: stderr=';

describe('the classification reads the Docker CLI’s own forms only (card containers-10)', () => {
  for (const [name, stderr, expected, detail] of [
    [
      'R5: an unreadable config warning, then form 3',
      `${FORM_6_WARNING}\n${FORM_3}`,
      'engineError',
      'S144',
    ],
    [
      'R6: an unreadable config warning, then form 5',
      `${FORM_6_WARNING}\n${FORM_5}`,
      'permission',
      'S104',
    ],
    [
      'R7: an unreadable config warning, then form 11',
      `${FORM_6_WARNING}\n${FORM_11}`,
      'notFound',
      'S144',
    ],
    [
      'R8: an HTTP server that is not an engine, whose page says File not found',
      FORM_7,
      'engineError',
      'S144',
    ],
    [
      'R9: an ssh host that refuses the login',
      `${FORM_8_START}nosuchuser0201@build.example: Permission denied (publickey,gssapi-keyex,gssapi-with-mic).\r\n`,
      'engineError',
      'S144',
    ],
    [
      'R10: an ssh host with no docker on its path',
      `${FORM_8_START}bash: line 1: docker: command not found`,
      'engineError',
      'S144',
    ],
    [
      'R11: an ssh host whose banner runs over several lines',
      `${FORM_8_START}Welcome to build.example\nPermission denied, please try again.\nbash: docker: command not found`,
      'engineError',
      'S144',
    ],
    [
      'R12: a config warning that names a not-found folder, then form 3',
      `WARNING: Error parsing config file (/srv/notfound/config.json): unexpected end of JSON input\n${FORM_3}`,
      'engineError',
      'S144',
    ],
    [
      'R13: each line ends with a carriage return',
      `${FORM_5}\r\n${FORM_6_WARNING}\r\n`,
      'permission',
      'S104',
    ],
    [
      'R14: a daemon prefix in the middle of a line decides nothing',
      'wrapper: Error response from daemon: x not found',
      'notFound',
      'S144',
    ],
    [
      'R14b: a warning prefix in the middle of a line is read',
      'wrapper: WARNING: permission denied',
      'permission',
      'S104',
    ],
    [
      'R15a: a wrapper text with capitals',
      'Error: Permission Denied',
      'permission',
      'S104',
    ],
    [
      'R15b: a wrapper text that says command not found',
      'f0201: command not found',
      'notFound',
      'S144',
    ],
    [
      'form 4: a daemon that is not running',
      'Cannot connect to the Docker daemon at tcp://127.0.0.1:1. Is the docker daemon running?',
      'engineError',
      'S144',
    ],
  ] as const) {
    it(`ADR-0010, F-0201 BR-3: ${name}`, () => {
      deepStrictEqual(
        [
          firstCheckOutcomeOf(SPAWN, [GOOD, exited(1, stderr)]),
          secondCheckOutcomeOf(SPAWN, exited(1, stderr)),
        ],
        [expected, {kind: 'failed', detail}],
      );
    });
  }

  it('ADR-0010: a warning on a query that exits 0 passes both checks', () => {
    deepStrictEqual(
      [
        firstCheckOutcomeOf(SPAWN, [
          exited(0, FORM_6_WARNING),
          exited(0, FORM_6_WARNING, PASSING_REPLY),
        ]),
        secondCheckOutcomeOf(SPAWN, exited(0, FORM_6_WARNING)),
      ],
      ['passed', {kind: 'passed'}],
    );
  });
});
