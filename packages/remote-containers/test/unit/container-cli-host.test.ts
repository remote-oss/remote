import {deepStrictEqual} from 'node:assert';
import {containerCliHost} from '../../src/cli/container-cli-host.ts';
import {fakeSystem, markerLine} from './cli-system.fixture.ts';

describe('the CLI host in the bootstrap container (card containers-151)', () => {
  it('ADR-0009: the CLI runs by docker exec on the image’s Node, each variable passed by name with its value in the client’s environment', async () => {
    const fake = fakeSystem();
    const running = containerCliHost(
      '/usr/bin/docker',
      'c1',
      {DOCKER_HOST: 'unix:///run/d.sock'},
      fake.ports,
    ).run(
      ['up', '--workspace-folder', '/workspaces/r'],
      () => undefined,
      new AbortController().signal,
      undefined,
      {COMPOSE_PROJECT_NAME: 'r_devcontainer'},
    );
    fake.exit(0);
    await running;
    deepStrictEqual(fake.spawns, [
      {
        program: '/usr/bin/docker',
        programArguments: [
          'exec',
          '--interactive',
          '--env',
          'BUILDKIT_PROGRESS',
          '--env',
          'COMPOSE_PROJECT_NAME',
          '--env',
          'ELECTRON_RUN_AS_NODE',
          '--env',
          'REMOTE_OSS_EDITOR_MODULES',
          'c1',
          'node',
          '--require',
          '/usr/local/share/remote-oss/cli-preload.js',
          '/usr/local/share/remote-oss/devcontainers-cli/devcontainer.js',
          'up',
          '--workspace-folder',
          '/workspaces/r',
        ],
        options: {
          shell: false,
          detached: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            DOCKER_HOST: 'unix:///run/d.sock',
            BUILDKIT_PROGRESS: 'plain',
            COMPOSE_PROJECT_NAME: 'r_devcontainer',
            ELECTRON_RUN_AS_NODE: '1',
            REMOTE_OSS_EDITOR_MODULES: '',
          },
        },
      },
    ]);
  });

  it('the preload’s marker offers stdin as plain while the run goes on, and an abort signals the Docker client’s group', async () => {
    const fake = fakeSystem();
    const cancellation = new AbortController();
    const offered: string[] = [];
    const running = containerCliHost('docker', 'c1', {}, fake.ports).run(
      ['up'],
      () => undefined,
      cancellation.signal,
      (deliver, presentation) =>
        offered.push(`${typeof deliver} ${presentation}`),
    );
    await new Promise(setImmediate);
    fake.stderr.write(markerLine(false));
    await new Promise(setImmediate);
    const beforeEnd = [...offered];
    cancellation.abort();
    fake.exit(null);
    const ended = await running;
    deepStrictEqual(
      [beforeEnd, fake.signals[0], ended],
      [
        ['function plain'],
        [4242, 'SIGTERM'],
        {kind: 'ran', result: undefined, status: null},
      ],
    );
  });
});
