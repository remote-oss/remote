import {deepStrictEqual} from 'node:assert';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {cliBridgeOf} from '../../src/cli/cli-bridge.ts';
import {nodeCliHost} from '../../src/cli/node-cli-host.ts';
import type {NodeCliPorts} from '../../src/cli/node-cli-ports.ts';

const PACKAGE = path.join(import.meta.dirname, '..', '..');

/** Every regular file under `folder`, as paths. */
function filesUnder(folder: string): string[] {
  return readdirSync(folder, {recursive: true})
    .map(name => path.join(folder, String(name)))
    .filter(file => statSync(file).isFile());
}

describe('the contract rows of the CLI bridge (card containers-04)', () => {
  it('R-26: the arguments the CLI is started with hold neither the secret nor the name of its variable', async () => {
    const stdout = new PassThrough();
    const seen: string[][] = [];
    const ports: NodeCliPorts = {
      spawn: (program, programArguments) => {
        seen.push([program, ...programArguments]);
        stdout.end(
          '{"outcome":"success","containerId":"c","remoteUser":"r","remoteWorkspaceFolder":"/w"}\n',
        );
        return Promise.resolve({
          kind: 'spawned',
          process: {
            processId: 1,
            stdin: new PassThrough(),
            stdout,
            stderr: new PassThrough().end(),
            exited: Promise.resolve(0),
          },
        });
      },
      killGroup: () => undefined,
    };
    const environment = {GITHUB_TOKEN: 's3cr3t-token'};
    const bridge = cliBridgeOf(
      nodeCliHost(
        {node: '/n', entry: '/e.js', preload: '/p.js'},
        environment,
        ports,
      ),
      {
        readText: () =>
          Promise.resolve(
            '{"containerEnv": {"T": "${localEnv:GITHUB_TOKEN}"}}',
          ),
      },
      {
        write: () => Promise.resolve('/o.json'),
        remove: () => Promise.resolve(),
      },
      environment,
      createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
    );
    await bridge.up(
      {
        workspaceFolder: '/work/a b/"q"',
        configFile: '/work/a b/.devcontainer/devcontainer.json',
        dockerPath: 'docker',
        idLabels: [],
        mountWorkspaceGitRoot: true,
        mountGitWorktreeCommonDir: false,
        mounts: [],
        logLevel: 'info',
      },
      {
        removeExistingContainer: false,
        buildNoCache: false,
        workspaceMountConsistency: 'cached',
      },
      () => undefined,
      new AbortController().signal,
    );
    const argv = seen.flat();
    deepStrictEqual(
      [
        argv.some(argument => argument.includes('s3cr3t-token')),
        argv.some(argument => argument.includes('GITHUB_TOKEN')),
        argv.includes('/work/a b/"q"'),
      ],
      [false, false, true],
    );
  });

  it('C3: the dependency on the dev container CLI is pinned to an exact version', () => {
    const version = (
      JSON.parse(readFileSync(path.join(PACKAGE, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>;
      }
    ).dependencies['@devcontainers/cli'];
    deepStrictEqual(
      [version, /[\^~<>*x ]/.test(version ?? '')],
      ['0.89.0', false],
    );
  });

  it('C3: no source file outside src/cli names the CLI or its folder', () => {
    deepStrictEqual(
      filesUnder(path.join(PACKAGE, 'src'))
        .filter(file => !file.startsWith(path.join(PACKAGE, 'src', 'cli')))
        .filter(file =>
          /@devcontainers\/cli|devcontainers-cli/.test(
            readFileSync(file, 'utf8'),
          ),
        )
        .map(file => path.relative(PACKAGE, file)),
      [],
    );
  });
});
