/**
 * @fileoverview The recovery container's restart (card containers-162): the bootstrap container and its tools, the
 * stopped container's image across a changed setting, and a container of another temp root left as it is.
 */

import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  type BrokenRepository,
  startBrokenRepository,
} from '../windows/broken-repository.ts';
import {
  closeWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  windowState,
} from '../windows/harness.ts';
import {dockerLines, removeClone} from '../windows/volume-clones.ts';
import {
  FIRST,
  inspected,
  reachRecovery,
  recoveryContainers,
  volumeOf,
} from './recovery-support.ts';

const execFileAsync = promisify(execFile);

describe('The recovery container (card containers-160)', function () {
  this.timeout(2_400_000);
  let repository: BrokenRepository;
  let settingsBefore: string | undefined;

  before(async () => {
    repository = await startBrokenRepository();
    settingsBefore = readUserSettings();
    await removeClone(repository.url);
    await removeClone(repository.otherUrl);
  });

  after(async () => {
    restoreUserSettings(settingsBefore);
    await removeClone(repository.url);
    await removeClone(repository.otherUrl);
    await repository.stop();
  });

  it('F-0410 AC-16, AC-16a, AC-16b: the recovery button connects a container of the bootstrap image on the volume, with Git and a docker client but no daemon, and a second start restarts the same container', async () => {
    await reachRecovery(repository.url, FIRST);
    const volume = await volumeOf(repository.url);
    const [container] = await recoveryContainers(volume);
    const tools = await execFileAsync('docker', [
      'exec',
      String(container),
      'sh',
      '-c',
      'git --version; docker version 2>&1; true',
    ]);
    const mounted = await inspected(
      String(container),
      '{{range .Mounts}}{{.Name}} {{end}}',
    );
    const state = await windowState(FIRST);
    const first = {
      count: (await recoveryContainers(volume)).length,
      remoteName: state.remoteName,
      image: await inspected(String(container), '{{.Config.Image}}'),
      mounted: mounted.trim(),
      hasGit: tools.stdout.includes('git version'),
      hasClient: tools.stdout.includes('Client:'),
      noDaemon: tools.stdout.includes(
        'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
      ),
    };
    await closeWindow(FIRST);
    await execFileAsync('docker', ['stop', String(container)]);
    await reachRecovery(repository.url, FIRST);
    const restarted = {
      containers: await recoveryContainers(volume),
      running: await inspected(String(container), '{{.State.Running}}'),
    };
    await closeWindow(FIRST);
    deepStrictEqual(
      {first, restarted},
      {
        first: {
          count: 1,
          remoteName: 'dev-container',
          image: 'vsc-volume-bootstrap:latest',
          mounted: volume,
          hasGit: true,
          hasClient: true,
          noDaemon: true,
        },
        restarted: {containers: [container], running: 'true'},
      },
    );
  });

  it('F-0410 AC-29: a stopped recovery container is restarted on its own image after the bootstrap image setting changed', async () => {
    const volume = await volumeOf(repository.url);
    const [container] = await recoveryContainers(volume);
    await execFileAsync('docker', ['stop', String(container)]);
    const before = await inspected(String(container), '{{.Image}}');
    await userSettings({'dev.containers.bootstrapImage': 'alpine:3.20'});
    await reachRecovery(repository.url, FIRST);
    deepStrictEqual(
      {
        containers: await recoveryContainers(volume),
        image: await inspected(String(container), '{{.Image}}'),
        running: await inspected(String(container), '{{.State.Running}}'),
        fromNewImage: await dockerLines(
          'ps',
          '-a',
          '-q',
          '--filter',
          `ancestor=alpine:3.20`,
          '--filter',
          `label=vsch.local.volume=${volume}`,
        ),
      },
      {
        containers: [container],
        image: before,
        running: 'true',
        fromNewImage: [],
      },
    );
    await closeWindow(FIRST);
    restoreUserSettings(settingsBefore);
  });

  it('F-0410 AC-28: a stopped container with the labels of another temp root is left as it is, and a new one is made', async () => {
    const volume = await volumeOf(repository.url);
    const [recovery] = await recoveryContainers(volume);
    await execFileAsync('docker', ['rm', '-f', String(recovery)]);
    const {stdout} = await execFileAsync('docker', [
      'create',
      '--label',
      `vsch.local.volume=${volume}`,
      '--label',
      'devcontainer.config_file=/other-root/vsch-other/recovery-volume/0/x/.devcontainer.json',
      'alpine:3.20',
      'sleep',
      '1d',
    ]);
    const stopped = stdout.trim();
    await reachRecovery(repository.url, FIRST);
    const containers = await recoveryContainers(volume);
    deepStrictEqual(
      {
        count: containers.length,
        oldKept: containers.some(each => stopped.startsWith(each)),
        oldRunning: await inspected(stopped, '{{.State.Running}}'),
        oldLabel: await inspected(
          stopped,
          '{{index .Config.Labels "devcontainer.config_file"}}',
        ),
      },
      {
        count: 2,
        oldKept: true,
        oldRunning: 'false',
        oldLabel:
          '/other-root/vsch-other/recovery-volume/0/x/.devcontainer.json',
      },
    );
    await closeWindow(FIRST);
  });
});
