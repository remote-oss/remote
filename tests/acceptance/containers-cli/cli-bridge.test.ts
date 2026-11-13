import {deepStrictEqual} from 'node:assert';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {cliBridgeOf} from '../../../packages/remote-containers/src/cli/cli-bridge.ts';
import {cliPathsOf} from '../../../packages/remote-containers/src/cli/cli-paths.ts';
import type {CliTarget} from '../../../packages/remote-containers/src/cli/cli-arguments.ts';
import {nodeCliHost} from '../../../packages/remote-containers/src/cli/node-cli-host.ts';
import {systemCliPorts} from '../../../packages/remote-containers/src/cli/node-cli-ports.ts';

const REPOSITORY_ROOT = path.join(import.meta.dirname, '..', '..', '..');
const PACKAGE = path.join(REPOSITORY_ROOT, 'packages', 'remote-containers');
const RUN_LABEL = `remote-oss.c3-row=${randomBytes(6).toString('hex')}`;

/** The five files the CLI ships as, relative to its folder. */
const CLI_FILES = [
  'devcontainer.js',
  'dist/spec-node/devContainersSpecCLI.js',
  'scripts/updateUID.Dockerfile',
  'LICENSE.txt',
  'ThirdPartyNotices.txt',
];

function digestOf(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

describe('the dev container CLI shipped in the package (card containers-04)', () => {
  const installed = path.join(PACKAGE, 'node_modules', '@devcontainers', 'cli');

  it('C3: the built package holds the five files of the CLI, the same bytes as the installed package', () => {
    deepStrictEqual(
      CLI_FILES.map(file =>
        existsSync(path.join(PACKAGE, 'dist', 'devcontainers-cli', file))
          ? digestOf(path.join(PACKAGE, 'dist', 'devcontainers-cli', file)) ===
            digestOf(path.join(installed, file))
          : false,
      ),
      CLI_FILES.map(() => true),
    );
  });

  it('C3: the VSIX holds the five files under extension/dist/devcontainers-cli/, and the preload', () => {
    const version = (
      JSON.parse(readFileSync(path.join(PACKAGE, 'package.json'), 'utf8')) as {
        version: string;
      }
    ).version;
    const listing = execFileSync(
      'unzip',
      [
        '-Z1',
        path.join(REPOSITORY_ROOT, 'dist', `remote-containers-${version}.vsix`),
      ],
      {encoding: 'utf8'},
    ).split('\n');
    deepStrictEqual(
      [
        ...CLI_FILES.map(file =>
          listing.includes(`extension/dist/devcontainers-cli/${file}`),
        ),
        listing.includes('extension/dist/cli-preload.js'),
      ],
      [...CLI_FILES.map(() => true), true],
    );
  });
});

describe('the dev container CLI through the bridge, on local Docker (card containers-04)', function () {
  this.timeout(600000);
  let folder = '';
  let initializeProbe = '';

  before(function () {
    if (spawnSync('docker', ['version']).status !== 0) {
      this.skip();
    }
    folder = mkdtempSync(path.join(tmpdir(), 'c3-row-'));
    initializeProbe = path.join(folder, 'initialize-probe');
    mkdirSync(path.join(folder, 'ws', '.devcontainer'), {recursive: true});
    writeFileSync(
      path.join(folder, 'ws', '.devcontainer', 'devcontainer.json'),
      JSON.stringify({
        name: 'c3-${localEnv:C3_EMPTY:dflt}',
        image: 'alpine:3.22',
        postCreateCommand: 'echo created > /tmp/c3-created',
        initializeCommand: `printf '%s' '\${containerEnv:PATH}' > ${initializeProbe}`,
      }),
    );
  });

  after(() => {
    if (folder === '') {
      return;
    }
    const containers = spawnSync(
      'docker',
      ['ps', '-aq', '--filter', `label=${RUN_LABEL}`],
      {encoding: 'utf8'},
    ).stdout.split('\n');
    for (const container of containers.filter(each => each !== '')) {
      spawnSync('docker', ['rm', '-f', container]);
    }
    rmSync(folder, {recursive: true, force: true});
  });

  function target(): CliTarget {
    const workspaceFolder = path.join(folder, 'ws');
    const configFile = path.join(
      workspaceFolder,
      '.devcontainer',
      'devcontainer.json',
    );
    return {
      workspaceFolder,
      configFile,
      dockerPath: 'docker',
      idLabels: [
        `devcontainer.local_folder=${workspaceFolder}`,
        `devcontainer.config_file=${configFile}`,
        RUN_LABEL,
      ],
      mountWorkspaceGitRoot: true,
      mountGitWorktreeCommonDir: false,
      features: {defaultFeatures: {}, lockfile: true},
      mounts: [],
      logLevel: 'info',
    };
  }

  const environment = {...process.env, C3_EMPTY: ''};
  function bridge(): ReturnType<typeof cliBridgeOf> {
    return cliBridgeOf(
      nodeCliHost(
        {node: process.execPath, ...cliPathsOf(PACKAGE, '/nowhere')},
        environment,
        systemCliPorts,
      ),
      {readText: file => Promise.resolve(readFileSync(file, 'utf8'))},
      {
        write: text => {
          const file = path.join(folder, 'override.json');
          writeFileSync(file, text);
          return Promise.resolve(file);
        },
        remove: file => {
          rmSync(file, {force: true});
          return Promise.resolve();
        },
      },
      environment,
      createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
    );
  }

  let containerId = '';
  const never = new AbortController().signal;
  const options = {
    removeExistingContainer: false,
    buildNoCache: false,
    workspaceMountConsistency: 'cached',
    gpuAvailability: 'detect',
  };

  it('C3: up creates the container, as root, with the workspace under /workspaces', async () => {
    const result = await bridge().up(target(), options, () => undefined, never);
    if (result.kind === 'up') {
      containerId = result.containerId;
    }
    deepStrictEqual(
      result.kind === 'up'
        ? [result.kind, result.remoteUser, result.remoteWorkspaceFolder]
        : result,
      ['up', 'root', '/workspaces/ws'],
    );
  });

  it('F-0304 AC-66: read-configuration gives the name with the default of the empty variable', async () => {
    const result = await bridge().readConfiguration(
      target(),
      containerId,
      () => undefined,
      never,
    );
    deepStrictEqual(
      result.kind === 'configuration' ? result.configuration.name : result,
      'c3-dflt',
    );
  });

  it('C3: run-user-commands runs postCreateCommand in the container', async () => {
    const result = await bridge().runUserCommands(
      target(),
      containerId,
      () => undefined,
      never,
    );
    deepStrictEqual(
      [
        result,
        execFileSync(
          'docker',
          ['exec', containerId, 'cat', '/tmp/c3-created'],
          {
            encoding: 'utf8',
          },
        ).trim(),
      ],
      [{kind: 'done'}, 'created'],
    );
  });

  it('C3: a second up gives the same container', async () => {
    const result = await bridge().up(target(), options, () => undefined, never);
    deepStrictEqual(
      result.kind === 'up' ? result.containerId : result,
      containerId,
    );
  });

  it('F-0408 AC-14: the configuration and merged configuration that up gives are the read of the same container, except that each lifecycle list holds its commands once, as the container’s label does', async () => {
    const featured = path.join(folder, 'featured');
    mkdirSync(path.join(featured, '.devcontainer', 'feat'), {recursive: true});
    writeFileSync(
      path.join(featured, '.devcontainer', 'devcontainer.json'),
      JSON.stringify({
        name: 'featured',
        image: 'alpine:3.22',
        features: {'./feat': {}},
        containerEnv: {PLAIN: '1'},
        remoteEnv: {WITH: '${containerEnv:PLAIN}'},
        postCreateCommand: 'echo created',
        postStartCommand: 'echo started',
      }),
    );
    writeFileSync(
      path.join(featured, '.devcontainer', 'feat', 'devcontainer-feature.json'),
      JSON.stringify({
        id: 'feat',
        version: '1.0.0',
        name: 'Feat',
        containerEnv: {FEAT: 'on'},
        postCreateCommand: 'echo feature',
        customizations: {vscode: {extensions: ['x.y']}},
      }),
    );
    writeFileSync(
      path.join(featured, '.devcontainer', 'feat', 'install.sh'),
      '#!/bin/sh\nexit 0\n',
      {mode: 0o755},
    );
    const featuredConfig = path.join(
      featured,
      '.devcontainer',
      'devcontainer.json',
    );
    const featuredTarget: CliTarget = {
      ...target(),
      workspaceFolder: featured,
      configFile: featuredConfig,
      idLabels: [
        `devcontainer.local_folder=${featured}`,
        `devcontainer.config_file=${featuredConfig}`,
        RUN_LABEL,
      ],
    };
    const upResult = await bridge().up(
      featuredTarget,
      options,
      () => undefined,
      never,
    );
    if (upResult.kind !== 'up') {
      throw new Error(`up failed: ${JSON.stringify(upResult)}`);
    }
    const read = await bridge().readConfiguration(
      featuredTarget,
      upResult.containerId,
      () => undefined,
      never,
    );
    if (read.kind !== 'configuration') {
      throw new Error(`the read failed: ${JSON.stringify(read)}`);
    }
    const label = JSON.parse(
      execFileSync(
        'docker',
        [
          'inspect',
          '--format',
          '{{index .Config.Labels "devcontainer.metadata"}}',
          upResult.containerId,
        ],
        {encoding: 'utf8'},
      ),
    ) as Array<Record<string, unknown>>;
    const lists = [
      ['onCreateCommand', 'onCreateCommands'],
      ['updateContentCommand', 'updateContentCommands'],
      ['postCreateCommand', 'postCreateCommands'],
      ['postStartCommand', 'postStartCommands'],
      ['postAttachCommand', 'postAttachCommands'],
    ] as const;
    const listNames: readonly string[] = lists.map(([, list]) => list);
    function withoutLists(
      merged: Record<string, unknown> | undefined,
    ): Record<string, unknown> {
      return Object.fromEntries(
        Object.entries(merged ?? {}).filter(
          ([key]) => !listNames.includes(key),
        ),
      );
    }
    deepStrictEqual(
      [
        upResult.configuration,
        withoutLists(upResult.mergedConfiguration),
        lists.map(([, list]) => [list, upResult.mergedConfiguration?.[list]]),
      ],
      [
        read.configuration,
        withoutLists(read.mergedConfiguration),
        lists.map(([command, list]) => [
          list,
          label
            .filter(entry => entry[command] !== undefined)
            .map(entry => entry[command]),
        ]),
      ],
    );
  });

  it('C3: the CLI passes `${containerEnv:…}` in `initializeCommand` through unsubstituted (ADR-0009 deviation 2’s premise)', () => {
    deepStrictEqual(
      readFileSync(initializeProbe, 'utf8'),
      '${containerEnv:PATH}',
    );
  });
});
