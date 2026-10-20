/**
 * @fileoverview The identity of an acceptance run, the one start of the SSH host container the editor and server
 * suites share, and the clean-up that leaves a shared self-hosted runner as the run found it.
 *
 *     node tools/acceptance-run.ts --clean
 *
 * Every Docker object of a run carries the run's label, so the clean-up removes only what one run made: its
 * containers, forced, its network and its image tag. What is already gone is not an error, and the shared machine is
 * never pruned.
 */

import {randomInt} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {checked, type CommandRunner, runCommand} from './command-runner.ts';
import {isMainModule, messageOf} from './repository.ts';

/** The label every Docker object of an acceptance run carries; its value is the run's id. */
export const RUN_LABEL = 'remote-oss.acceptance.run';

/**
 * How old an editor or a network of a CI run is before the opening clean takes it for one a killed job left behind:
 * two hours.
 */
const STALE_RUN_SECONDS = 7200;

/** The image name of the SSH host; the run's tag keeps each run's build and container its own. */
export const HOST_IMAGE = 'remote-oss-acceptance-host';

/** The label every dev container of the containers launches carries, and the images built for them. */
export const DEVCONTAINER_LABEL = 'remote-oss.acceptance.devcontainer';

/** The image name of the dev containers' base image; the run's tag keeps each run's build its own. */
export const DEVCONTAINER_IMAGE = 'remote-oss-acceptance-devcontainer';

/**
 * The run's id: `GITHUB_RUN_ID-GITHUB_RUN_ATTEMPT-GITHUB_JOB` in CI, else `local-<process id>`. The job's id is
 * in the id because the acceptance jobs of one workflow run share the run and the attempt, and may run at the
 * same time on runners that share a Docker daemon.
 */
export function acceptanceRunId(
  environment: NodeJS.ProcessEnv,
  processId: number,
): string {
  const runId = environment.GITHUB_RUN_ID;
  const attempt = environment.GITHUB_RUN_ATTEMPT;
  const jobId = environment.GITHUB_JOB;
  if (
    runId !== undefined &&
    runId !== '' &&
    attempt !== undefined &&
    attempt !== '' &&
    jobId !== undefined &&
    jobId !== ''
  ) {
    return `${runId}-${attempt}-${jobId}`;
  }
  return `local-${String(processId)}`;
}

/** The image tag of the run: `remote-oss-acceptance-host:<run id>`. */
export function hostImageOf(runId: string): string {
  return `${HOST_IMAGE}:${runId}`;
}

/** The image tag of the run's dev container image: `remote-oss-acceptance-devcontainer:<run id>`. */
export function devContainerImageOf(runId: string): string {
  return `${DEVCONTAINER_IMAGE}:${runId}`;
}

/**
 * Builds the run's dev container image from `tests/acceptance/devcontainer-image`, labelled with the run and as a dev
 * container's, and returns its tag.
 */
export function buildDevContainerImage(
  command: CommandRunner,
  root: string,
  runId: string,
): string {
  const imageTag = devContainerImageOf(runId);
  checked(command, 'docker', [
    'build',
    '--load',
    // the build's own output goes to stderr, so a failed step's error reaches the thrown message (2026-10-20: an
    // `apk add` that failed on one runner showed only "did not complete" under --quiet)
    '--progress=plain',
    '--label',
    `${RUN_LABEL}=${runId}`,
    '--label',
    `${DEVCONTAINER_LABEL}=1`,
    '--tag',
    imageTag,
    path.join(root, 'tests', 'acceptance', 'devcontainer-image'),
  ]);
  return imageTag;
}

/** The ids of a quiet Docker listing, one per line. */
function idsOf(quiet: string): string[] {
  return quiet
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');
}

/** One Docker object of an `inspect` line: its id, the run it carries and its creation time. */
interface LabelledObject {
  objectId: string;
  runId: string;
  createdSeconds: number;
}

/** The format of an `inspect` line: the id, the run label's value and the creation time, separated by spaces. */
const LABELLED_FORMAT = `{{.Id}} {{index .Config.Labels "${RUN_LABEL}"}} {{.Created}}`;

/** The objects of `inspect` lines in `LABELLED_FORMAT`. */
function labelledObjects(lines: string): LabelledObject[] {
  return lines
    .split('\n')
    .map(line => line.trim().split(' '))
    .filter(fields => fields.length === 3)
    .map(([objectId = '', runId = '', created = '']) => ({
      objectId,
      runId,
      createdSeconds: Date.parse(created) / 1000,
    }));
}

/**
 * Removes the dev containers and their images that another run left: each with the dev container label, another run's
 * label and a creation time more than two hours before `nowSeconds`. Age is the key, not another run's id alone,
 * because two jobs may share a runner's daemon and a younger object belongs to a run that may still be going.
 */
export function sweepStaleDevContainers(
  command: CommandRunner,
  runId: string,
  nowSeconds: number,
): void {
  function isStale(object: LabelledObject): boolean {
    return (
      object.runId !== runId &&
      nowSeconds - object.createdSeconds > STALE_RUN_SECONDS
    );
  }
  const filter = `label=${DEVCONTAINER_LABEL}=1`;
  const containers = idsOf(
    checked(command, 'docker', ['ps', '--all', '--quiet', '--filter', filter]),
  );
  if (containers.length > 0) {
    for (const stale of labelledObjects(
      checked(command, 'docker', [
        'inspect',
        '--type',
        'container',
        '--format',
        LABELLED_FORMAT,
        ...containers,
      ]),
    ).filter(isStale)) {
      checked(command, 'docker', [
        'rm',
        '--force',
        '--volumes',
        stale.objectId,
      ]);
    }
  }
  const images = idsOf(
    checked(command, 'docker', [
      'image',
      'ls',
      '--quiet',
      '--no-trunc',
      '--filter',
      filter,
    ]),
  );
  if (images.length > 0) {
    for (const stale of labelledObjects(
      checked(command, 'docker', [
        'image',
        'inspect',
        '--format',
        LABELLED_FORMAT,
        ...images,
      ]),
    ).filter(isStale)) {
      // An image another stale container still used is gone with it, or still in use by a live one: no error.
      command('docker', ['image', 'rm', '--force', stale.objectId]);
    }
  }
}

/** The name of the run's own Docker network: `remote-oss-acceptance-<run id>`. */
export function runNetworkOf(runId: string): string {
  return `remote-oss-acceptance-${runId}`;
}

/** The format of a network's `inspect` line: its creation time in seconds, and how many containers it holds. */
const NETWORK_AGE_FORMAT = '{{.Created.Unix}} {{len .Containers}}';

/**
 * Removes the networks that a killed or cancelled run left: each with the run label of any run, older than two hours
 * before `nowMilliseconds` and with no container (Docker's default address pool runs out after about 30 networks). A
 * younger network, or one with a container, is another job's. One that cannot be read is skipped, and one that
 * another job removed first is no error.
 */
function sweepStaleNetworks(
  command: CommandRunner,
  nowMilliseconds: number,
): void {
  const nowSeconds = nowMilliseconds / 1000;
  for (const networkId of idsOf(
    checked(command, 'docker', [
      'network',
      'ls',
      '--quiet',
      '--filter',
      `label=${RUN_LABEL}`,
    ]),
  )) {
    const inspected = command('docker', [
      'network',
      'inspect',
      '--format',
      NETWORK_AGE_FORMAT,
      networkId,
    ]);
    const fields = /^(\d+) (\d+)$/.exec(inspected.stdout.trim());
    if (inspected.status !== 0 || fields === null) {
      continue;
    }
    const [, created = '', containers = ''] = fields;
    if (
      nowSeconds - Number(created) > STALE_RUN_SECONDS &&
      Number(containers) === 0
    ) {
      command('docker', ['network', 'rm', networkId]);
    }
  }
}

/**
 * Connects the host container to the run's own network as well as Docker's default one, and returns its address
 * there: the address the `routed` alias reaches without Docker's published port. The networks that a killed run left
 * are swept first. A run with two host containers shares one network.
 */
export function connectRunNetwork(
  command: CommandRunner,
  runId: string,
  container: string,
  now: () => number = Date.now,
): string {
  sweepStaleNetworks(command, now());
  const name = runNetworkOf(runId);
  if (command('docker', ['network', 'inspect', name]).status !== 0) {
    checked(command, 'docker', [
      'network',
      'create',
      '--label',
      `${RUN_LABEL}=${runId}`,
      name,
    ]);
  }
  checked(command, 'docker', ['network', 'connect', name, container]);
  const address = checked(command, 'docker', [
    'inspect',
    '--format',
    `{{(index .NetworkSettings.Networks "${name}").IPAddress}}`,
    container,
  ]).trim();
  if (address === '') {
    throw new Error(`the host ${container} has no address on ${name}`);
  }
  return address;
}

/** The characters of the run's password for the user `harness-pw`, and its length. */
const PASSWORD_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const PASSWORD_LENGTH = 24;

/** A password of 24 letters and digits; `pick` gives a whole number below its argument (`randomInt` by default). */
export function newPassword(
  pick: (limit: number) => number = limit => randomInt(limit),
): string {
  return Array.from(
    {length: PASSWORD_LENGTH},
    () => PASSWORD_ALPHABET[pick(PASSWORD_ALPHABET.length)],
  ).join('');
}

/** What a started host container is: its id, its mapped SSH port, and the key and password files of the run. */
export interface HostContainer {
  container: string;
  port: number;
  keyFile: string;
  /** The file holding the bare password of the user `harness-pw`, mode 600. */
  passwordFile: string;
}

/** The host port Docker maps to the container's port 22, from `docker port` output such as `127.0.0.1:49153`. */
export function mappedPort(dockerPortOutput: string): number {
  const match = /:(\d+)\s*$/m.exec(dockerPortOutput);
  if (match?.[1] === undefined) {
    throw new Error(`no mapped port in '${dockerPortOutput.trim()}'`);
  }
  return Number(match[1]);
}

/**
 * Builds the run's image, makes the run's key and password in `runFolder`, and runs the labelled container: the one
 * start of the host both acceptance harnesses share. The password reaches the container in an env file, never in a
 * command line. `extraArguments` go to `docker run` before the image, such as the `--env` of a host variant.
 */
export function startHostContainer(
  command: CommandRunner,
  root: string,
  runId: string,
  runFolder: string,
  extraArguments: readonly string[] = [],
): HostContainer {
  checked(command, 'docker', [
    'build',
    '--load',
    '--progress=plain', // as the dev container image's build: a failed step's error reaches the thrown message
    '--tag',
    hostImageOf(runId),
    path.join(root, 'tests', 'acceptance', 'host'),
  ]);
  const keyFile = path.join(runFolder, 'id_ed25519');
  checked(command, 'ssh-keygen', [
    '-q',
    '-t',
    'ed25519',
    '-N',
    '',
    '-C',
    'acceptance',
    '-f',
    keyFile,
  ]);
  const publicKey = readFileSync(`${keyFile}.pub`, 'utf8').trim();
  const password = newPassword();
  const passwordFile = path.join(runFolder, 'password');
  const environmentFile = path.join(runFolder, 'host.env');
  writeFileSync(passwordFile, password, {mode: 0o600});
  writeFileSync(environmentFile, `HOST_PASSWORD=${password}\n`, {mode: 0o600});
  const container = checked(command, 'docker', [
    'run',
    '--detach',
    '--rm',
    '--label',
    `${RUN_LABEL}=${runId}`,
    '--env',
    `AUTHORIZED_KEY=${publicKey}`,
    '--env-file',
    environmentFile,
    '--cap-add',
    'NET_ADMIN',
    '--publish',
    '127.0.0.1::22',
    ...extraArguments,
    hostImageOf(runId),
  ]).trim();
  const port = mappedPort(
    checked(command, 'docker', ['port', container, '22']),
  );
  return {container, port, keyFile, passwordFile};
}

/**
 * Removes the run's containers (by the run's label, forced) and its networks, ends an editor still on the run's
 * user-data folder, and removes its image tags and its dev containers' images; what is already gone is not an
 * error. A container or a network that still carries the run's label afterwards makes it throw, naming the ids, so a
 * failed removal fails the run instead of keeping the run's state on the shared machine.
 */
export function cleanRun(command: CommandRunner, runId: string): void {
  const filter = `label=${RUN_LABEL}=${runId}`;
  // The images of the run's dev containers, noted before the containers go; the run's own tag is removed below.
  const devContainerImages = idsOf(
    checked(command, 'docker', [
      'ps',
      '--all',
      '--filter',
      filter,
      '--filter',
      `label=${DEVCONTAINER_LABEL}=1`,
      '--format',
      '{{.Image}}',
    ]),
  );
  for (const containerId of idsOf(
    checked(command, 'docker', ['ps', '--all', '--quiet', '--filter', filter]),
  )) {
    checked(command, 'docker', ['rm', '--force', '--volumes', containerId]);
  }
  for (const networkId of idsOf(
    checked(command, 'docker', [
      'network',
      'ls',
      '--quiet',
      '--filter',
      filter,
    ]),
  )) {
    checked(command, 'docker', ['network', 'rm', networkId]);
  }
  // An editor that a killed job left holds the run's user-data folder, named by the run's id; none running is no error.
  command('pkill', ['-f', '--', `acceptance-${runId}-[A-Za-z0-9]+/user-data`]);
  // So does one that a runner left from an earlier CI run, whose id this run does not know: CI ids are numeric, local
  // ones are not, and only an editor older than any job's time limit is taken to be left over, not another job's.
  command('pkill', [
    '-O',
    String(STALE_RUN_SECONDS),
    '-f',
    '--',
    'acceptance-[0-9]+-[0-9]+-[A-Za-z0-9_-]+-[A-Za-z0-9]+/user-data',
  ]);
  // The images may already be gone: their removal's status is ignored.
  command('docker', ['image', 'rm', '--force', hostImageOf(runId)]);
  for (const image of new Set([
    ...devContainerImages,
    devContainerImageOf(runId),
  ])) {
    command('docker', ['image', 'rm', '--force', image]);
  }
  const remaining = idsOf(
    checked(command, 'docker', ['ps', '--all', '--quiet', '--filter', filter]),
  );
  const remainingNetworks = idsOf(
    checked(command, 'docker', [
      'network',
      'ls',
      '--quiet',
      '--filter',
      filter,
    ]),
  );
  const left = [
    ...(remaining.length > 0
      ? [`containers after the clean-up: ${remaining.join(', ')}`]
      : []),
    ...(remainingNetworks.length > 0
      ? [`networks after the clean-up: ${remainingNetworks.join(', ')}`]
      : []),
  ];
  if (left.length > 0) {
    throw new Error(`the run ${runId} still owns ${left.join(' and ')}`);
  }
}

if (isMainModule(import.meta.url)) {
  try {
    cleanRun(runCommand, acceptanceRunId(process.env, process.pid));
  } catch (error) {
    console.error(`acceptance: ${messageOf(error)}`);
    process.exitCode = 1;
  }
}
