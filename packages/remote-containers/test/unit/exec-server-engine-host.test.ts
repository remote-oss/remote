import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {REPORTING_SCRIPT} from 'lib-server';
import {
  KILLED_STATUS,
  PROCESS_ID,
  sceneOf,
  settled,
} from 'lib-server/testing/fake-exec-host';
import {execServerEngineHost} from '../../src/engine/exec-server-engine-host.ts';

const NEVER = new AbortController().signal;

describe('the Docker CLI on the exec server’s host (card containers-174)', () => {
  it('a run starts docker under the reporting shell with the engine’s variables in the environment, never in the arguments, and gives back what it printed without the process id', async () => {
    const scene = sceneOf({status: 3, complaint: 'warning'});
    const outcome = await execServerEngineHost(scene.server, 'docker').run(
      ['ps', '-q'],
      {kind: 'text', text: 'given'},
      {
        environment: {DOCKER_HOST: 'unix:///run/docker.sock'},
        cancellation: NEVER,
      },
    );
    deepStrictEqual(
      [outcome, scene.asked],
      [
        {kind: 'ran', status: 3, stdout: 'given', stderr: 'warning'},
        [
          {
            command: 'sh',
            argv: ['-c', REPORTING_SCRIPT, 'sh', 'docker', 'ps', '-q'],
            options: {env: {DOCKER_HOST: 'unix:///run/docker.sock'}},
          },
        ],
      ],
    );
  });

  it('a local file is streamed as the input, no input ends it at once, and a refused spawn fails with its reason', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'exec-engine-'));
    try {
      const file = path.join(folder, 'context.tar');
      writeFileSync(file, 'bytes of a file');
      const fromFile = await execServerEngineHost(
        sceneOf().server,
        'docker',
      ).run(['load'], {kind: 'file', localFile: file}, {cancellation: NEVER});
      const none = await execServerEngineHost(sceneOf().server, 'docker').run(
        ['version'],
        {kind: 'none'},
        {cancellation: NEVER},
      );
      const refused = await execServerEngineHost(
        sceneOf({refuse: true}).server,
        'docker',
      ).run(['version'], {kind: 'none'}, {cancellation: NEVER});
      deepStrictEqual(
        [fromFile, none, refused],
        [
          {kind: 'ran', status: 0, stdout: 'bytes of a file', stderr: ''},
          {kind: 'ran', status: 0, stdout: '', stderr: ''},
          {kind: 'failed', detail: 'the control connection is closed'},
        ],
      );
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });

  it('a long-running command that ignores the end of its input, such as docker events, stops when its run is cancelled, killed by its process id', async () => {
    const scene = sceneOf({ignoresInput: true});
    const controller = new AbortController();
    const running = execServerEngineHost(scene.server, 'docker').run(
      ['events'],
      {kind: 'none'},
      {cancellation: controller.signal},
    );
    await settled();
    await settled();
    controller.abort();
    const outcome = await running;
    deepStrictEqual(
      {outcome, killed: scene.killed, inputEnded: scene.inputEnded},
      {
        outcome: {kind: 'ran', status: KILLED_STATUS, stdout: '', stderr: ''},
        killed: [PROCESS_ID],
        inputEnded: true,
      },
    );
  });
});
