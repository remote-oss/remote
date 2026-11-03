/**
 * @fileoverview F-0205 AC-39 (card containers-142): the Dev Containers view follows a Docker context switch made outside
 * the editor while it is shown, and keeps its listing when only the endpoint stops answering.
 */

import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from 'node:net';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  devContainerFolder,
  containersLog,
  inWindow,
  runLabelArguments,
  runScopedName,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {rowsWhen, VIEW} from '../windows/dev-containers-view.ts';
import {welcomeText} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** An endpoint nothing listens on: the discard port refuses connections. */
const DEAD = 'tcp://127.0.0.1:9';

/** The words of the welcome content that the view shows when it reaches no engine. */
const NO_ENGINE_WORDS = 'installing Docker';

/** How long the view has, after the switch, to follow it. */
const FOLLOW_MILLISECONDS = 5000;

/** The Docker configuration folder of the launch, which holds the contexts the rows create. */
function dockerConfig(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'docker-config');
}

/** The output of `docker` run with `parameters` in the launch's own Docker configuration. */
async function dockerIn(...parameters: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', parameters, {
    env: {...process.env, DOCKER_CONFIG: dockerConfig()},
  });
  return stdout.trim();
}

/** Whether `check` holds within `milliseconds`, looked at every 250 ms and with no refresh of the view. */
async function holdsWithin(
  milliseconds: number,
  check: () => Promise<boolean>,
): Promise<boolean> {
  try {
    await waitFor('the view to follow', check, milliseconds);
    return true;
  } catch {
    return false;
  }
}

/** Whether the shown view lists the row labelled `label`. */
async function lists(label: string): Promise<boolean> {
  try {
    await rowsWhen(
      'local',
      rows => rows.some(each => each.label === label),
      250,
    );
    return true;
  } catch {
    return false;
  }
}

/** Whether the shown view has the welcome content of an unreachable engine. */
async function showsNoEngine(): Promise<boolean> {
  return ((await welcomeText('local', VIEW)) ?? '').includes(NO_ENGINE_WORDS);
}

/** A TCP address on this machine that forwards to the engine's socket, until it is closed. */
async function forwarderTo(socketPath: string): Promise<{
  address: string;
  connections(): number;
  close(): void;
}> {
  const sockets = new Set<Socket>();
  let accepted = 0;
  const server: Server = createServer(client => {
    accepted += 1;
    const engine = createConnection(socketPath);
    sockets.add(client);
    sockets.add(engine);
    client.pipe(engine).pipe(client);
    for (const socket of [client, engine]) {
      socket.on('error', () => {
        client.destroy();
        engine.destroy();
      });
      socket.on('close', () => {
        sockets.delete(socket);
        client.destroy();
        engine.destroy();
      });
    }
  });
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port =
    typeof address === 'object' && address !== null ? address.port : 0;
  return {
    address: `tcp://127.0.0.1:${String(port)}`,
    connections: () => accepted,
    close: () => {
      server.close();
      for (const socket of sockets) {
        socket.destroy();
      }
    },
  };
}

describe('the Dev Containers view follows a Docker context switch (card containers-142)', function () {
  this.timeout(600_000);

  const contexts: string[] = [];
  const containers: string[] = [];
  let closers: Array<() => void> = [];

  /** A running container only the current engine holds, as a dev container the view lists under the name of `folder`. */
  async function listedContainer(name: string): Promise<string> {
    const folder = devContainerFolder(name);
    const container = runScopedName(name);
    containers.push(container);
    await dockerIn(
      'run',
      '-d',
      '--name',
      container,
      ...runLabelArguments(),
      '--label',
      `devcontainer.local_folder=${folder}`,
      variable('HARNESS_DEVCONTAINER_IMAGE'),
      'sleep',
      '600',
    );
    return path.basename(folder);
  }

  afterEach(async () => {
    await dockerIn('context', 'use', 'default').catch(() => undefined);
    for (const context of contexts.splice(0)) {
      await dockerIn('context', 'rm', '--force', context).catch(
        () => undefined,
      );
    }
    for (const close of closers.splice(0)) {
      close();
    }
    closers = [];
    for (const container of containers.splice(0)) {
      await execFileAsync('docker', ['rm', '-f', container]).catch(
        () => undefined,
      );
    }
  });

  it('F-0205 AC-39 (c142-switch): with the view shown, a switch to a context that is broken shows the welcome content of an unreachable engine within 5 s, and the switch back lists the containers again within 5 s, with no action in the editor', async () => {
    const label = await listedContainer('c142-switch');
    await inWindow('local', 'workbench.view.remote');
    const listedBefore = await holdsWithin(60_000, () => lists(label));
    await dockerIn(
      'context',
      'create',
      'c142-broken',
      '--docker',
      `host=${DEAD}`,
    );
    contexts.push('c142-broken');
    await dockerIn('context', 'use', 'c142-broken');
    const broken = await holdsWithin(FOLLOW_MILLISECONDS, showsNoEngine);
    await dockerIn('context', 'use', 'default');
    const back = await holdsWithin(FOLLOW_MILLISECONDS, () => lists(label));
    deepStrictEqual([listedBefore, broken, back], [true, true, true]);
  });

  it('F-0205 AC-39 (c142-dead-endpoint): with a working context, an endpoint that stops answering with no change of configuration leaves the listing until Refresh, which then shows the welcome content', async () => {
    const host = await dockerIn(
      'context',
      'inspect',
      'default',
      '--format',
      '{{.Endpoints.docker.Host}}',
    );
    const forwarder = await forwarderTo(host.replace(/^unix:\/\//, ''));
    closers.push(() => {
      forwarder.close();
    });
    await dockerIn(
      'context',
      'create',
      'c142-forwarded',
      '--docker',
      `host=${forwarder.address}`,
    );
    contexts.push('c142-forwarded');
    await inWindow('local', 'workbench.view.remote');
    const mark = containersLog().length;
    await dockerIn('context', 'use', 'c142-forwarded');
    const followed = await holdsWithin(FOLLOW_MILLISECONDS, () =>
      Promise.resolve(forwarder.connections() > 0),
    );
    // A container made now shows only once the view has read through the forwarder.
    const label = await listedContainer('c142-endpoint');
    const listed = await holdsWithin(FOLLOW_MILLISECONDS, () => lists(label));
    // The events of the container's making still come in for a moment, and each rebuilds the view once it is quiet.
    await new Promise(resolve => setTimeout(resolve, 5_000));
    forwarder.close();
    await new Promise(resolve => setTimeout(resolve, 10_000));
    const kept = await lists(label);
    const noEngineBeforeRefresh = await showsNoEngine();
    await inWindow('local', 'remote-containers.explorerTargetsRefresh').catch(
      () => undefined,
    );
    const afterRefresh = await holdsWithin(20_000, showsNoEngine);
    deepStrictEqual(
      [followed, listed, kept, noEngineBeforeRefresh, afterRefresh],
      [true, true, true, false, true],
      containersLog().slice(mark).join('\n'),
    );
  });
});
