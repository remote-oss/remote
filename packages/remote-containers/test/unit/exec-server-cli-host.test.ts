import {deepStrictEqual} from 'node:assert';
import {mock} from 'node:test';
import {spawnSync} from 'node:child_process';
import {chmodSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {GROUP_SCRIPT, type ExecServer} from 'lib-server';
import {hostStream, sceneOf, settled} from 'lib-server/testing/fake-exec-host';
import {localExecServer} from 'lib-server/testing/local-exec-server';
import type {CliLine} from '../../src/cli/cli-host.ts';
import type {PlacedCli} from '../../src/cli/cli-paths.ts';
import {execServerCliHost} from '../../src/cli/exec-server-cli-host.ts';

const PLACED: PlacedCli = {
  node: '/home/dev/.vscode-server/bin/abc/node',
  entry:
    '/home/dev/.vscode-server/remote-oss-containers-cli/1.2.3/devcontainer.js',
  preload:
    '/home/dev/.vscode-server/remote-oss-containers-cli/1.2.3/cli-preload.js',
  editorModules: '/home/dev/.vscode-server/bin/abc/node_modules',
};

const HOST_ENVIRONMENT = {
  HOME: '/home/dev',
  SSH_CONNECTION: '10.0.0.1 5000 10.0.0.2 22',
};

const NEVER = new AbortController().signal;

/** Whether the process `processId` of this machine runs: one that has ended and not yet been reaped is gone. */
function stateOf(processId: string): 'running' | 'gone' {
  const state = spawnSync('ps', ['-o', 'stat=', '-p', processId], {
    encoding: 'utf8',
  }).stdout.trim();
  return state === '' || state.startsWith('Z') ? 'gone' : 'running';
}

/** The exec server of `scene`'s host, whose environment is the SSH host's. */
function serverOf(
  spawnOn: Pick<ExecServer, 'spawn'>,
  environment: () => Promise<{env: Record<string, string>}> = () =>
    Promise.resolve({env: HOST_ENVIRONMENT}),
): Pick<ExecServer, 'spawn' | 'env'> {
  return {
    spawn: spawnOn.spawn,
    env: () =>
      environment().then(read => ({
        env: read.env,
        osPlatform: 'linux',
        osRelease: '6.1',
      })),
  };
}

describe('the dev container CLI on the SSH host (card #3244)', () => {
  it('F-1302 AC-2, AC-20: the CLI runs on the host’s own node under the group script, with the host’s environment and the run’s variables, none of them in an argument', async () => {
    const scene = sceneOf({
      firstLines: ['4242\n', '{"outcome":"success"}\n', 'a log line\n'],
      closesAtOnce: true,
    });
    const lines: CliLine[] = [];
    const outcome = await execServerCliHost(serverOf(scene.server), PLACED).run(
      ['up', '--workspace-folder', '/home/dev/project'],
      line => lines.push(line),
      NEVER,
      undefined,
      {COMPOSE_PROJECT_NAME: 'project_devcontainer'},
    );
    deepStrictEqual(
      [outcome, lines, scene.asked],
      [
        {kind: 'ran', result: '{"outcome":"success"}', status: 0},
        [
          {stream: 'stdout', line: '{"outcome":"success"}'},
          {stream: 'stdout', line: 'a log line'},
        ],
        [
          {
            command: 'sh',
            argv: [
              '-c',
              GROUP_SCRIPT,
              'sh',
              PLACED.node,
              '--require',
              PLACED.preload,
              PLACED.entry,
              'up',
              '--workspace-folder',
              '/home/dev/project',
            ],
            options: {
              env: {
                ...HOST_ENVIRONMENT,
                BUILDKIT_PROGRESS: 'plain',
                COMPOSE_PROJECT_NAME: 'project_devcontainer',
                ELECTRON_RUN_AS_NODE: '1',
                REMOTE_OSS_EDITOR_MODULES: PLACED.editorModules,
              },
            },
          },
        ],
      ],
    );
  });

  it('a host whose environment can’t be read, an error or a bare text, and a spawn it refuses fail the start with their reason, and run nothing', async () => {
    const refused = await execServerCliHost(
      serverOf(sceneOf({refuse: true}).server),
      PLACED,
    ).run([], () => undefined, NEVER);
    const unread = await execServerCliHost(
      serverOf(sceneOf().server, () =>
        Promise.reject(new Error('the connection closed')),
      ),
      PLACED,
    ).run([], () => undefined, NEVER);
    const textual = await execServerCliHost(
      serverOf(sceneOf().server, () =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the exec server may reject with a bare text
        Promise.reject('no environment'),
      ),
      PLACED,
    ).run([], () => undefined, NEVER);
    deepStrictEqual(
      [refused, unread, textual],
      [
        {kind: 'spawnFailed', message: 'the control connection is closed'},
        {kind: 'spawnFailed', message: 'the connection closed'},
        {kind: 'spawnFailed', message: 'no environment'},
      ],
    );
  });

  it('a CLI that the host reports no exit status for ends the run with no status', async () => {
    const scene = sceneOf({firstLines: ['4242\n'], closesAtOnce: true});
    const server = serverOf({
      spawn: (command, argumentList, options) =>
        scene.server.spawn(command, argumentList, options).then(spawned => ({
          ...spawned,
          onExit: spawned.onExit.then(() => Promise.reject(new Error('lost'))),
        })),
    });
    deepStrictEqual(
      await execServerCliHost(server, PLACED).run([], () => undefined, NEVER),
      {kind: 'ran', result: undefined, status: null},
    );
  });

  /** A host whose CLI runs until `finish` is called, and that is asked for each signal to its group. */
  function hostWithSignals(refuseSignals: boolean): {
    server: Pick<ExecServer, 'spawn' | 'env'>;
    signals: string[][];
    finish(): void;
  } {
    const signals: string[][] = [];
    const stdout = hostStream();
    const stderr = hostStream();
    let finished: ((exit: {status: number}) => void) | undefined;
    const running = new Promise<{status: number}>(resolve => {
      finished = resolve;
    });
    const ended = Promise.resolve({status: 0});
    const server = serverOf({
      spawn: (command, argumentList) => {
        if (argumentList[1]?.startsWith('kill ') === true) {
          signals.push(argumentList.slice(-2));
          return refuseSignals
            ? Promise.reject(new Error('the connection closed'))
            : Promise.resolve({
                stdin: {write: () => undefined, end: () => undefined},
                stdout: hostStream().stream,
                stderr: hostStream().stream,
                onExit: ended,
              });
        }
        setImmediate(() => {
          stdout.send('4242\n');
        });
        return Promise.resolve({
          stdin: {write: () => undefined, end: () => undefined},
          stdout: stdout.stream,
          stderr: stderr.stream,
          onExit: running,
        });
      },
    });
    return {
      server,
      signals,
      finish: () => {
        stdout.end();
        stderr.end();
        finished?.({status: 143});
      },
    };
  }

  it('an abort asks the host to end the CLI’s group, and kills it after 5 s if it has not ended, and a host that cannot be asked is let go', async () => {
    mock.timers.enable({apis: ['setTimeout']});
    try {
      const outcomes = [];
      for (const refuse of [false, true]) {
        const host = hostWithSignals(refuse);
        const controller = new AbortController();
        const running = execServerCliHost(host.server, PLACED).run(
          [],
          () => undefined,
          controller.signal,
        );
        await settled();
        await settled();
        controller.abort();
        await settled();
        const afterAbort = host.signals.map(each => [...each]);
        mock.timers.tick(5000);
        await settled();
        host.finish();
        outcomes.push([afterAbort, host.signals, await running]);
      }
      deepStrictEqual(outcomes, [
        [
          [['TERM', '4242']],
          [
            ['TERM', '4242'],
            ['KILL', '4242'],
          ],
          {kind: 'ran', result: undefined, status: null},
        ],
        [
          [['TERM', '4242']],
          [
            ['TERM', '4242'],
            ['KILL', '4242'],
          ],
          {kind: 'ran', result: undefined, status: null},
        ],
      ]);
    } finally {
      mock.timers.reset();
    }
  });

  describe('run for real, on a shell of this machine', () => {
    let folder = '';
    let node = '';

    beforeEach(() => {
      folder = mkdtempSync(path.join(tmpdir(), 'exec-cli-'));
      node = path.join(folder, 'node');
      writeFileSync(
        node,
        '#!/bin/sh\nsleep 61 &\nfirst=$!\nsleep 62 &\nprintf "%s %s\\n" "$first" "$!" >&2\nwait\n',
      );
      chmodSync(node, 0o755);
    });

    afterEach(() => {
      rmSync(folder, {recursive: true, force: true});
    });

    it('an abort ends the CLI and the children it started, which a plain kill of its process would leave running', async () => {
      const controller = new AbortController();
      const children: string[] = [];
      const host = execServerCliHost(
        serverOf(localExecServer(), () =>
          Promise.resolve({env: {PATH: process.env.PATH ?? '/usr/bin:/bin'}}),
        ),
        {...PLACED, node},
      );
      const before: string[] = [];
      const outcome = await host.run(
        [],
        line => {
          children.push(...line.line.split(' '));
          before.push(...children.map(stateOf));
          controller.abort();
        },
        controller.signal,
      );
      deepStrictEqual(
        [outcome, before, children.map(stateOf)],
        [
          {kind: 'ran', result: undefined, status: null},
          ['running', 'running'],
          ['gone', 'gone'],
        ],
      );
    });
  });
});
