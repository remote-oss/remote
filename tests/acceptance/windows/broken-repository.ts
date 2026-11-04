import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

/** A public image, pinned by digest, that ships `git daemon`: the one the conformance runner serves its repositories from. */
const GIT_IMAGE =
  'mcr.microsoft.com/devcontainers/base@sha256:edfb983aab9c579a385dc23c57d7d3703f5ec920124d99c16204a2cac465aab4';

/** The Dockerfile of the broken repository: its build always fails. */
const BROKEN_DOCKERFILE = 'FROM alpine:3.20\\nRUN exit 1\\n';

/** What the container runs: a repository whose dev container can't be built, served read-only over `git://`. */
const SERVE = [
  'set -e',
  'git init -q -b main /tmp/work',
  'cd /tmp/work',
  'mkdir .devcontainer',
  `printf '${BROKEN_DOCKERFILE}' > .devcontainer/Dockerfile`,
  `printf '{"build": {"dockerfile": "Dockerfile"}}\\n' > .devcontainer/devcontainer.json`,
  'git add -A',
  'git commit -q -m broken',
  'git clone -q --bare /tmp/work /srv/broken.git',
  'git clone -q --bare /tmp/work /srv/broken-two.git',
  'exec git daemon --base-path=/srv --export-all --reuseaddr --listen=0.0.0.0',
].join('; ');

/** A repository whose clone succeeds and whose dev container build then fails, served from a container of the run. */
export interface BrokenRepository {
  /** The address the clone is typed with, which the bootstrap container reaches. */
  url: string;
  /** The same repository again under another name, for a second clone and its own volume. */
  otherUrl: string;
  /** Removes the serving container. */
  stop(): Promise<void>;
}

/** The container's name: one per process, so that parallel runs don't meet. */
function containerName(): string {
  return `vsc-acceptance-broken-repository-${String(process.pid)}`;
}

/** Waits until the daemon in `name` answers a `git ls-remote` on its own address. */
async function waitForDaemon(name: string): Promise<void> {
  const until = Date.now() + 60_000;
  for (;;) {
    try {
      await execFileAsync('docker', [
        'exec',
        name,
        'git',
        'ls-remote',
        'git://127.0.0.1/broken-two.git',
      ]);
      return;
    } catch (failure) {
      if (Date.now() > until) {
        throw failure;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

/** Starts the serving container, removing one an earlier run of this process left, and returns the repository. */
export async function startBrokenRepository(): Promise<BrokenRepository> {
  const name = containerName();
  await execFileAsync('docker', ['rm', '-f', name]);
  await execFileAsync('docker', [
    'run',
    '--detach',
    '--name',
    name,
    '--read-only',
    '--tmpfs',
    '/tmp',
    '--tmpfs',
    '/srv',
    '--env',
    'GIT_AUTHOR_NAME=fixture',
    '--env',
    'GIT_AUTHOR_EMAIL=fixture@example.invalid',
    '--env',
    'GIT_COMMITTER_NAME=fixture',
    '--env',
    'GIT_COMMITTER_EMAIL=fixture@example.invalid',
    '--env',
    'GIT_CONFIG_GLOBAL=/dev/null',
    '--env',
    'HOME=/tmp',
    '--entrypoint',
    'sh',
    GIT_IMAGE,
    '-c',
    SERVE,
  ]);
  await waitForDaemon(name);
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '--format',
    '{{.NetworkSettings.Networks.bridge.IPAddress}}',
    name,
  ]);
  const address = stdout.trim();
  return {
    url: `git://${address}/broken.git`,
    otherUrl: `git://${address}/broken-two.git`,
    stop: async () => {
      await execFileAsync('docker', ['rm', '-f', name]);
    },
  };
}
