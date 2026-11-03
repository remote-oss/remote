import {deepStrictEqual, ok} from 'node:assert';
import {readFileSync} from 'node:fs';
import {
  BOOTSTRAP_TOOLS,
  type BootstrapTool,
  bootstrapRemoveArguments,
  bootstrapRunArguments,
  bootstrapSettingsOf,
  imageArgumentsOf,
  toolCheckArguments,
  toolCheckLineOf,
  toolCheckOutcomeOf,
} from '../../src/volumes/bootstrap.ts';
import {BOOTSTRAP_CLI} from '../../src/cli/cli-paths.ts';

/** The tools found when `tools` are the ones missing. */
function withoutTools(...tools: BootstrapTool[]): Set<BootstrapTool> {
  return new Set(BOOTSTRAP_TOOLS.filter(tool => !tools.includes(tool)));
}

const BUILT_IN = {image: '', pull: false, socketPath: '/var/run/docker.sock'};

describe('the bootstrap container (card containers-151)', () => {
  it('F-0704 BR-1: our image is the package’s Alpine definition with the five tools and the CLI, built every pass under our tag', () => {
    const lines = readFileSync(
      new URL('../../resources/volume-bootstrap/Dockerfile', import.meta.url),
      'utf8',
    ).split('\n');
    deepStrictEqual(
      [
        lines[0],
        lines[1],
        lines.filter(line => line.startsWith('COPY ')),
        imageArgumentsOf(BUILT_IN, '/ctx'),
      ],
      [
        'FROM alpine:3.20',
        'RUN apk add --no-cache ca-certificates docker-cli docker-cli-compose git git-lfs nodejs openssh-client',
        [
          `COPY devcontainers-cli ${BOOTSTRAP_CLI.entry.slice(0, -'/devcontainer.js'.length)}`,
          `COPY cli-preload.js ${BOOTSTRAP_CLI.preload}`,
        ],
        {
          image: 'vsc-volume-bootstrap:latest',
          calls: [
            ['build', '--tag', 'vsc-volume-bootstrap:latest', '--', '/ctx'],
          ],
        },
      ],
    );
  });

  it('F-0704: a custom image is used as it is, and pulled first only when its setting asks', () => {
    deepStrictEqual(
      [
        imageArgumentsOf({...BUILT_IN, image: 'my/boot:1'}, '/ctx'),
        imageArgumentsOf({...BUILT_IN, image: 'my/boot:1', pull: true}, '/ctx'),
      ],
      [
        {image: 'my/boot:1', calls: []},
        {image: 'my/boot:1', calls: [['pull', '--', 'my/boot:1']]},
      ],
    );
  });

  it('the container runs as root with the volume at /workspaces and the socket the setting names', () => {
    const runArguments = bootstrapRunArguments(
      'img',
      'r-1',
      '/run/user/docker.sock',
    );
    deepStrictEqual(
      [
        runArguments.slice(0, 8),
        runArguments.slice(8, 11),
        runArguments[11],
        runArguments.includes('--name'),
        runArguments.includes('--label'),
      ],
      [
        [
          'run',
          '--detach',
          '--user',
          'root',
          '--mount',
          'type=volume,src=r-1,dst=/workspaces',
          '--mount',
          'type=bind,src=/run/user/docker.sock,dst=/var/run/docker.sock',
        ],
        ['--entrypoint', '/bin/sh', 'img'],
        '-c',
        false,
        false,
      ],
    );
  });

  it('a mount field holding a comma or a quote is CSV-quoted, its quotes doubled, so it adds no option', () => {
    const runArguments = bootstrapRunArguments('img', 'r-1', '/run/a,b"c.sock');
    deepStrictEqual(runArguments.slice(4, 8), [
      '--mount',
      'type=volume,src=r-1,dst=/workspaces',
      '--mount',
      'type=bind,"src=/run/a,b""c.sock",dst=/var/run/docker.sock',
    ]);
  });

  it('F-0704 BR-6: each tool is looked for on PATH, its name passed as the shell’s argument, never as code', () => {
    deepStrictEqual(toolCheckArguments('c1', 'git-lfs'), [
      'exec',
      'c1',
      '/bin/sh',
      '-c',
      'command -v -- "$0" >/dev/null',
      'git-lfs',
    ]);
  });

  it('F-0704 BR-7, BR-8: no docker is S344 even without git, no git is S345, and the other three are optional', () => {
    const all = new Set<BootstrapTool>(BOOTSTRAP_TOOLS);
    deepStrictEqual(
      [
        toolCheckOutcomeOf(all),
        toolCheckOutcomeOf(withoutTools('node', 'ssh', 'git-lfs')),
        toolCheckOutcomeOf(withoutTools('docker', 'git')),
        toolCheckOutcomeOf(withoutTools('git')),
      ],
      [
        {kind: 'ok'},
        {kind: 'ok'},
        {kind: 'missing', reason: 'S344'},
        {kind: 'missing', reason: 'S345'},
      ],
    );
  });

  it('the check logs one line naming each tool in its order', () => {
    deepStrictEqual(
      toolCheckLineOf(new Set<BootstrapTool>(['docker', 'git'])),
      "the bootstrap container's tools: docker found, git found, node missing, ssh missing, git-lfs missing",
    );
  });

  it('the container is removed by force, its id after `--`', () => {
    ok(bootstrapRemoveArguments('c1').join(' ') === 'rm --force -- c1');
  });

  it('F-0704 BR-14: the settings as read: unset, empty or mistyped values fall back, and set ones are trimmed', () => {
    deepStrictEqual(
      [
        bootstrapSettingsOf({
          image: undefined,
          pull: 'yes',
          socketPath: undefined,
        }),
        bootstrapSettingsOf({image: 3, pull: undefined, socketPath: '  '}),
        bootstrapSettingsOf({
          image: ' my/boot:1 ',
          pull: true,
          socketPath: ' /run/podman.sock ',
        }),
      ],
      [
        BUILT_IN,
        BUILT_IN,
        {image: 'my/boot:1', pull: true, socketPath: '/run/podman.sock'},
      ],
    );
  });
});
