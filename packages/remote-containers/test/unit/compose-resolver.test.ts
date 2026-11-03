import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {EngineRunOutcome} from '../../src/engine/engine-host.ts';
import type {ComposeRoute} from '../../src/engine/compose-route.ts';
import {
  type ComposeResolution,
  composeResolverOf,
} from '../../src/compose/resolver.ts';

/** What the fake client and Compose hold. */
interface World {
  configuration: string;
  files?: Record<string, string>;
  compose?: EngineRunOutcome;
  environment?: Record<string, string | undefined>;
  route?: ComposeRoute;
}

/** The services Compose prints for a two-service project. */
const TWO_SERVICES: EngineRunOutcome = {
  kind: 'ran',
  status: 0,
  stdout: 'name: devcontainer\nservices:\n  app: {}\n  db: {}\n',
  stderr: '',
};

/** Resolves the configuration of `world` in the workspace folder `/w`; gives the resolution, Compose's calls and the lines. */
async function resolve(world: World): Promise<{
  resolution: ComposeResolution;
  calls: string[][];
  lines: string[];
}> {
  const sink = new MemorySink();
  const calls: string[][] = [];
  const files: Record<string, string> = {
    '/w/.devcontainer/devcontainer.json': world.configuration,
    ...world.files,
  };
  const resolution = await composeResolverOf({
    route: () => Promise.resolve(world.route ?? {kind: 'plugin'}),
    runVia: (route, argv) => {
      calls.push([route.kind === 'plugin' ? 'plugin' : route.file, ...argv]);
      return Promise.resolve(world.compose ?? TWO_SERVICES);
    },
    readText: (file: string) =>
      file in files
        ? Promise.resolve(files[file] ?? '')
        : Promise.reject(new Error('ENOENT')),
    environment: world.environment ?? {},
    logger: createLogger(sink, {minimumLevel: () => 'info'}),
  })({
    workspaceFolder: '/w',
    configFile: '/w/.devcontainer/devcontainer.json',
    cancellation: new AbortController().signal,
  });
  return {resolution, calls, lines: sink.lines.map(line => line.message)};
}

const COMPOSE_CONFIGURATION =
  '{"dockerComposeFile": "compose.yml", "service": "app", "workspaceFolder": "/workspace"}';

describe('what a connect knows of a Compose configuration (F-0413, brief-compose §2)', () => {
  it('F-0413 AC-1: a Compose configuration gives the project name, the service and the scope of both services', async () => {
    const {resolution, calls} = await resolve({
      configuration: COMPOSE_CONFIGURATION,
    });
    deepStrictEqual(
      [
        resolution.kind === 'ready'
          ? [resolution.projectName, resolution.service, resolution.scope]
          : resolution,
        calls,
      ],
      [
        ['w_devcontainer', 'app', ['app', 'db']],
        [['plugin', '-f', '/w/.devcontainer/compose.yml', 'config']],
      ],
    );
  });

  it('F-0303 AC-26, AC-27: the primary service’s Dockerfile is the dockerfile against the build context, the default Dockerfile for the short form, and none for an image service', async () => {
    const outputs = [
      'services:\n  app:\n    build:\n      context: /w\n      dockerfile: .devcontainer/Df.app\n',
      'services:\n  app:\n    build:\n      context: /w\n',
      'services:\n  app:\n    build:\n      context: .\n      dockerfile: /abs/Df\n',
      'services:\n  app:\n    image: a\n',
      'services:\n  db: {}\n',
    ];
    const found: Array<string | undefined> = [];
    for (const stdout of outputs) {
      const {resolution} = await resolve({
        configuration: COMPOSE_CONFIGURATION,
        compose: {kind: 'ran', status: 0, stdout, stderr: ''},
      });
      found.push(
        resolution.kind === 'ready'
          ? resolution.serviceDockerfile
          : 'not ready',
      );
    }
    deepStrictEqual(found, [
      '/w/.devcontainer/Df.app',
      '/w/Dockerfile',
      '/abs/Df',
      undefined,
      undefined,
    ]);
  });

  it('F-0413 AC-5: runServices narrows the scope to the services it names', async () => {
    const {resolution} = await resolve({
      configuration:
        '{"dockerComposeFile": ["compose.yml"], "service": "app", "runServices": ["db"]}',
    });
    deepStrictEqual(
      resolution.kind === 'ready' ? resolution.scope : resolution,
      ['db', 'app'],
    );
  });

  it('F-0413 AC-9: a name: in a compose file names the project, and the editor’s COMPOSE_PROJECT_NAME wins over it', async () => {
    const files = {'/w/.devcontainer/compose.yml': 'name: declared\n'};
    const named = await resolve({
      configuration: COMPOSE_CONFIGURATION,
      files,
    });
    const process = await resolve({
      configuration: COMPOSE_CONFIGURATION,
      files,
      environment: {COMPOSE_PROJECT_NAME: 'proc'},
    });
    deepStrictEqual(
      [named.resolution, process.resolution].map(each =>
        each.kind === 'ready' ? each.projectName : each,
      ),
      ['declared', 'proc'],
    );
  });

  it('F-0413 AC-37: a configuration with an image, a dockerFile or a build.dockerfile besides the compose file, or with no service or no compose file, gives nothing and runs no Compose', async () => {
    const results = [];
    for (const configuration of [
      '{"dockerComposeFile": "c.yml", "service": "app", "image": "x"}',
      '{"dockerComposeFile": "c.yml", "service": "app", "dockerFile": "D"}',
      '{"dockerComposeFile": "c.yml", "service": "app", "build": {"dockerfile": "D"}}',
      '{"dockerComposeFile": "c.yml"}',
      '{"service": "app"}',
      '{"dockerComposeFile": [1], "service": "app"}',
      '{"dockerComposeFile": 5, "service": "app"}',
      '[1]',
      '',
      '{"image": "x"}',
    ]) {
      const {resolution, calls} = await resolve({configuration});
      results.push([resolution.kind, calls.length]);
    }
    deepStrictEqual(
      results,
      results.map(() => ['none', 0]),
    );
  });

  it('F-0413 AC-38: a build mapping with no dockerfile does not stop the compose route', async () => {
    const {resolution} = await resolve({
      configuration:
        '{"dockerComposeFile": "c.yml", "service": "app", "build": {"args": {}}, "runServices": "app"}',
    });
    deepStrictEqual(
      resolution.kind === 'ready' ? resolution.scope : resolution,
      ['app', 'db'],
    );
  });

  it('F-0413 AC-13: a model Compose rejects fails the resolution with Compose’s error', async () => {
    const {resolution} = await resolve({
      configuration: COMPOSE_CONFIGURATION,
      compose: {kind: 'ran', status: 1, stdout: '', stderr: 'bad yaml\n'},
    });
    deepStrictEqual(resolution, {kind: 'failed', detail: 'bad yaml'});
  });

  it('F-0413 AC-57: a name that is not valid fails the resolution before the CLI runs, and the log names the source', async () => {
    const {resolution, lines} = await resolve({
      configuration: COMPOSE_CONFIGURATION,
      environment: {COMPOSE_PROJECT_NAME: 'F0413ProcCaps'},
    });
    deepStrictEqual(
      [resolution, lines],
      [
        {
          kind: 'failed',
          detail: 'the project name "F0413ProcCaps" is not valid',
        },
        [
          'read the Compose model: 2 services',
          'the Compose project name from process is not valid: "F0413ProcCaps"',
        ],
      ],
    );
  });

  it('F-0201 AC-11, AC-29: a standalone Compose runs the model, is told to the CLI, and a version below 1.21 gives the name its letters and digits only', async () => {
    const {resolution, calls} = await resolve({
      configuration: COMPOSE_CONFIGURATION,
      route: {kind: 'standalone', file: '/opt/dc', dashAndUnderscore: false},
    });
    deepStrictEqual(
      [
        resolution.kind === 'ready'
          ? [resolution.projectName, resolution.composeFile]
          : resolution,
        calls,
      ],
      [
        ['wdevcontainer', '/opt/dc'],
        [['/opt/dc', '-f', '/w/.devcontainer/compose.yml', 'config']],
      ],
    );
  });

  it('F-0201 AC-6, AC-45: a Compose that is missing or broken at the connect fails the resolution before the model is read', async () => {
    const results = [];
    for (const route of [
      {kind: 'missing', written: '/nowhere/dc', byDefault: false},
      {kind: 'broken', written: '/opt/dc'},
    ] as const) {
      const {resolution, calls} = await resolve({
        configuration: COMPOSE_CONFIGURATION,
        route,
      });
      results.push([resolution, calls.length]);
    }
    deepStrictEqual(results, [
      [
        {kind: 'failed', detail: 'Docker Compose cannot be run: /nowhere/dc'},
        0,
      ],
      [{kind: 'failed', detail: 'Docker Compose cannot be run: /opt/dc'}, 0],
    ]);
  });

  it('F-0413 AC-17: a Compose project gets the build entitlement variable for its up, and a value the user set is left alone', async () => {
    const plain = await resolve({configuration: COMPOSE_CONFIGURATION});
    const userSet = await resolve({
      configuration: COMPOSE_CONFIGURATION,
      environment: {BUILDX_BAKE_ENTITLEMENTS_FS: '1'},
    });
    deepStrictEqual(
      [plain.resolution, userSet.resolution].map(each =>
        each.kind === 'ready' ? each.upEnvironment : each,
      ),
      [{BUILDX_BAKE_ENTITLEMENTS_FS: '0'}, {}],
    );
  });
});
