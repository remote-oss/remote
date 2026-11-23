import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {HostChannel, ScriptRequest} from 'lib-host';
import {
  commandsRan,
  markerInspectArguments,
  MARKERS_SCRIPT,
  markersNeeded,
  parseMarkerInspect,
} from '../../src/cli/cli-markers.ts';

const CREATED = '2026-11-12T06:50:35.123456789Z';
const NEVER = new AbortController().signal;

/** A root channel whose script run ends as `outcome` says and prints `lines`; it records the requests it got. */
function channelOf(
  outcome: Awaited<ReturnType<HostChannel['runScript']>>,
  lines: readonly string[],
): {channel: HostChannel; requests: ScriptRequest[]} {
  const requests: ScriptRequest[] = [];
  const channel = {
    runScript: (request: ScriptRequest, onLine: (line: string) => void) => {
      requests.push(request);
      for (const line of lines) {
        onLine(line);
      }
      return Promise.resolve(outcome);
    },
  } as unknown as HostChannel;
  return {channel, requests};
}

const FACTS = {
  user: 'vscode',
  environmentHome: undefined,
  created: CREATED,
  names: ['onCreateCommand', 'updateContentCommand'],
};

describe('the markers of the commands that already ran (card containers-219, F-0408 AC-14)', () => {
  it('the markers needed are the entries of the commands up to waitFor, which is updateContentCommand by default', () => {
    deepStrictEqual(
      [
        markersNeeded({
          onCreateCommands: ['a'],
          updateContentCommands: ['b'],
          postCreateCommands: ['c'],
        }),
        markersNeeded({onCreateCommands: [], updateContentCommands: ['b']}),
        markersNeeded({onCreateCommands: [], updateContentCommands: []}),
        markersNeeded({}),
      ],
      [
        ['onCreateCommand', 'updateContentCommand'],
        ['updateContentCommand'],
        [],
        [],
      ],
    );
  });

  it('a waitFor of onCreateCommand needs only its marker, and one of initializeCommand needs none', () => {
    deepStrictEqual(
      [
        markersNeeded({
          waitFor: 'onCreateCommand',
          onCreateCommands: ['a'],
          updateContentCommands: ['b'],
        }),
        markersNeeded({
          waitFor: 'initializeCommand',
          onCreateCommands: ['a'],
        }),
      ],
      [['onCreateCommand'], []],
    );
  });

  it('a waitFor beyond updateContentCommand, one that is no text, and no merged configuration need a run', () => {
    deepStrictEqual(
      [
        markersNeeded({waitFor: 'postCreateCommand'}),
        markersNeeded({waitFor: 'postStartCommand'}),
        markersNeeded({waitFor: 5}),
        markersNeeded(undefined),
      ],
      [undefined, undefined, undefined, undefined],
    );
  });

  it('the inspect asks for the creation time and the environment, and its answer gives them and the HOME the environment sets', () => {
    deepStrictEqual(
      [
        markerInspectArguments('c1'),
        parseMarkerInspect(`"${CREATED}"\n["PATH=/bin","HOME=/home/vscode"]\n`),
        parseMarkerInspect(`"${CREATED}"\n["PATH=/bin",5]\n`),
      ],
      [
        [
          'inspect',
          '--type',
          'container',
          '--format',
          '{{json .Created}}{{"\\n"}}{{json .Config.Env}}',
          'c1',
        ],
        {created: CREATED, environmentHome: '/home/vscode'},
        {created: CREATED, environmentHome: undefined},
      ],
    );
  });

  it('an inspect answer that is no creation time and environment gives nothing', () => {
    deepStrictEqual(
      [
        parseMarkerInspect(''),
        parseMarkerInspect('not json'),
        parseMarkerInspect(`5\n["PATH=/bin"]`),
        parseMarkerInspect(`"${CREATED}"\n"PATH"`),
      ],
      [undefined, undefined, undefined, undefined],
    );
  });

  it('no marker needed is true with no run, and a missing creation time is false with none', async () => {
    const {channel, requests} = channelOf({kind: 'exited', status: 0}, []);
    deepStrictEqual(
      [
        await commandsRan(channel, {...FACTS, names: []}, NEVER),
        await commandsRan(channel, {...FACTS, created: ''}, NEVER),
        requests.length,
      ],
      [true, false, 0],
    );
  });

  it('the root step gets the user, the HOME, the creation time and the names, and is true only for a clean exit that printed the line', async () => {
    const outcomes: boolean[] = [];
    const requests: ScriptRequest[] = [];
    for (const [outcome, lines] of [
      [{kind: 'exited', status: 0}, ['markers:ran']],
      [{kind: 'exited', status: 0}, []],
      [{kind: 'exited', status: 1}, ['markers:ran']],
      [
        {kind: 'failed', failure: {kind: 'spawnFailed', detail: 'x'}},
        ['markers:ran'],
      ],
    ] as const) {
      const made = channelOf(outcome, lines);
      outcomes.push(
        await commandsRan(
          made.channel,
          {...FACTS, environmentHome: '/home/vscode'},
          NEVER,
        ),
      );
      requests.push(...made.requests);
    }
    deepStrictEqual(
      [
        outcomes,
        requests[0]?.script,
        requests[0]?.interpreter,
        requests[0]?.environment,
      ],
      [
        [true, false, false, false],
        MARKERS_SCRIPT,
        'posixShell',
        {
          MARKER_USER: 'vscode',
          MARKER_ENV_HOME: '/home/vscode',
          MARKER_CREATED: CREATED,
          MARKER_NAMES: 'onCreateCommand updateContentCommand',
        },
      ],
    );
  });
});

describe('the markers of the dev container CLI 0.89.0, as the CLI writes them (card containers-219)', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'markers-'));
  const home = path.join(folder, 'home');
  const shims = path.join(folder, 'bin');

  before(() => {
    mkdirSync(path.join(home, '.devcontainer'), {recursive: true});
    mkdirSync(shims);
    writeFileSync(
      path.join(shims, 'getent'),
      `#!/bin/sh\nprintf 'vscode:x:1000:1000::${home}:/bin/sh\\n'\n`,
    );
    chmodSync(path.join(shims, 'getent'), 0o755);
  });

  after(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  /** What the CLI writes: the creation time and a line end, `echo '<time>' > <marker>`. */
  function written(name: string, text = `${CREATED}\n`): void {
    writeFileSync(path.join(home, '.devcontainer', `.${name}Marker`), text);
  }

  /** The verdict the script gives for the markers named, with the environment's HOME as given. */
  function verdict(names: string, environmentHome = ''): string {
    const result = spawnSync('sh', ['-c', MARKERS_SCRIPT], {
      encoding: 'utf8',
      env: {
        PATH: `${shims}:${process.env.PATH ?? ''}`,
        MARKER_USER: 'vscode',
        MARKER_ENV_HOME: environmentHome,
        MARKER_CREATED: CREATED,
        MARKER_NAMES: names,
      },
    });
    return `${String(result.status)}:${result.stdout.trim()}`;
  }

  it('the CLI is the version these markers were read from, so that a newer one fails here until its markers are read again', () => {
    deepStrictEqual(
      (
        JSON.parse(
          readFileSync(
            path.join(
              import.meta.dirname,
              '..',
              '..',
              'node_modules',
              '@devcontainers',
              'cli',
              'package.json',
            ),
            'utf8',
          ),
        ) as {version: string}
      ).version,
      '0.89.0',
    );
  });

  it('every marker holding the creation time, as the CLI writes it, is ran, with the HOME unset or the passwd home', () => {
    written('onCreateCommand');
    written('updateContentCommand');
    deepStrictEqual(
      [
        verdict('onCreateCommand updateContentCommand'),
        verdict('onCreateCommand updateContentCommand', home),
      ],
      ['0:markers:ran', '0:markers:ran'],
    );
  });

  it('a marker that is missing, holds another time or nothing, or a HOME that differs from the passwd home, prints nothing', () => {
    written('onCreateCommand');
    written('updateContentCommand', '2026-11-11T00:00:00Z\n');
    const another = verdict('onCreateCommand updateContentCommand');
    written('updateContentCommand', '');
    const empty = verdict('onCreateCommand updateContentCommand');
    rmSync(path.join(home, '.devcontainer', '.updateContentCommandMarker'));
    const missing = verdict('onCreateCommand updateContentCommand');
    written('updateContentCommand');
    const differing = verdict('onCreateCommand updateContentCommand', '/root');
    deepStrictEqual(
      [another, empty, missing, differing],
      ['0:', '0:', '0:', '0:'],
    );
  });

  it('a user that the container does not know prints nothing', () => {
    written('onCreateCommand');
    const result = spawnSync('sh', ['-c', MARKERS_SCRIPT], {
      encoding: 'utf8',
      env: {
        PATH: '/usr/bin:/bin',
        MARKER_USER: 'nobody-here-at-all',
        MARKER_ENV_HOME: '',
        MARKER_CREATED: CREATED,
        MARKER_NAMES: 'onCreateCommand',
      },
    });
    deepStrictEqual(result.stdout.trim(), '');
  });
});
