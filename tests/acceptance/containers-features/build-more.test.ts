import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {runLabelArguments, variable, waitFor} from '../windows/harness.ts';
import {removeContainers} from '../windows/folder-windows.ts';
import {
  featureBuilds,
  forgetImages,
  imagesOf,
  inspected,
  lockfileOf,
  metadataOf,
  readIn,
  runFeature,
  writeLocalFeature,
} from './features-support.ts';

const execFileAsync = promisify(execFile);

/** The ids of the Feature entries of the metadata, in order. */
function idsOf(entries: ReadonlyArray<Record<string, unknown>>): unknown[] {
  return entries
    .filter(entry => typeof entry.id === 'string')
    .map(entry => entry.id);
}

/** The Feature `user`, whose script makes the account `worker` with an id the host's user does not have. */
function writeUserFeature(folder: string): void {
  writeLocalFeature(folder, 'user', {
    script: 'adduser -D -u 4242 -s /bin/sh worker',
  });
}

describe('what a build with Features makes and keeps (card containers-93)', function () {
  this.timeout(1_800_000);
  const {build, reopen} = featureBuilds();

  it('F-0414 AC-29 (post-create-order): a Feature’s postCreateCommand finishes before the one of devcontainer.json starts', async () => {
    const built = await build(
      'c93-ac29',
      {
        features: {'./slow': {}},
        postCreateCommand: 'echo user >> /tmp/c93-order',
      },
      folder => {
        writeLocalFeature(folder, 'slow', {
          metadata: {
            postCreateCommand: 'sleep 3; echo feature >> /tmp/c93-order',
          },
        });
      },
    );
    async function lines(): Promise<string[]> {
      return (await readIn(built.containerId, '/tmp/c93-order').catch(() => ''))
        .split('\n')
        .filter(Boolean);
    }
    await waitFor(
      'both post-create commands to have run',
      async () => (await lines()).length === 2,
      60_000,
    );
    deepStrictEqual(await lines(), ['feature', 'user']);
  });

  it('F-0414 AC-30 (container-settings): privileged, capAdd, init and securityOpt of Features reach the container, with their variables', async () => {
    const built = await build(
      'c93-ac30',
      {features: {'./first': {}, './second': {}}},
      folder => {
        writeLocalFeature(folder, 'first', {
          metadata: {
            privileged: true,
            capAdd: ['SYS_PTRACE'],
            containerEnv: {C93_FIRST: 'one'},
          },
        });
        writeLocalFeature(folder, 'second', {
          metadata: {
            init: true,
            securityOpt: ['seccomp=unconfined'],
            containerEnv: {C93_SECOND: 'two'},
          },
        });
      },
    );
    const privileged = await inspected(
      built.containerId,
      '{{.HostConfig.Privileged}}',
    );
    const init = await inspected(built.containerId, '{{.HostConfig.Init}}');
    const capAdd = await inspected(
      built.containerId,
      '{{json .HostConfig.CapAdd}}',
    );
    const securityOpt = await inspected(
      built.containerId,
      '{{json .HostConfig.SecurityOpt}}',
    );
    const variables = await inspected(
      built.containerId,
      '{{json .Config.Env}}',
    );
    deepStrictEqual(
      [
        privileged,
        init,
        capAdd.includes('SYS_PTRACE'),
        securityOpt.includes('seccomp=unconfined'),
        variables.includes('C93_FIRST=one') &&
          variables.includes('C93_SECOND=two'),
      ],
      ['true', 'true', true, true, true],
    );
  });

  it('F-0414 AC-43 (order-edit-reuses): an edit that only changes overrideFeatureInstallOrder reuses the container, whose metadata order stays', async () => {
    const built = await build(
      'c93-ac43',
      {features: {'./alpha': {}, './beta': {}}},
      folder => {
        writeLocalFeature(folder, 'alpha');
        writeLocalFeature(folder, 'beta');
      },
    );
    writeFileSync(
      path.join(built.folder, '.devcontainer', 'devcontainer.json'),
      JSON.stringify({
        image: variable('HARNESS_DEVCONTAINER_IMAGE'),
        runArgs: runLabelArguments(),
        features: {'./alpha': {}, './beta': {}},
        overrideFeatureInstallOrder: ['./beta'],
      }),
    );
    const again = await reopen(built, false);
    deepStrictEqual(
      [again.containerId, idsOf(await metadataOf(again.containerId))],
      [built.containerId, ['./alpha', './beta']],
    );
  });

  it('F-0414 AC-47 (device-id-volume): a volume named with ${devcontainerId} gets the same name when the container is built again', async () => {
    const names: string[] = [];
    const built = await build('c93-ac47', {features: {'./vol': {}}}, folder => {
      writeLocalFeature(folder, 'vol', {
        metadata: {
          mounts: [
            {
              source: 'c93-vol-${devcontainerId}',
              target: '/mnt/c93-vol',
              type: 'volume',
            },
          ],
        },
      });
    });
    const query =
      '{{range .Mounts}}{{if eq .Destination "/mnt/c93-vol"}}{{.Name}}{{end}}{{end}}';
    const first = await inspected(built.containerId, query);
    const again = await reopen(built, true);
    const second = await inspected(again.containerId, query);
    names.push(first, second);
    await removeContainers(built.folder);
    await execFileAsync('docker', ['volume', 'rm', '-f', ...new Set(names)]);
    deepStrictEqual(
      [
        names.length,
        names[0] === names[1],
        names[0]?.startsWith('c93-vol-'),
        names[0]?.includes('devcontainerId'),
      ],
      [2, true, true, false],
    );
  });

  it('F-0414 AC-48 (root-dotfile): a root .devcontainer.json with a registry Feature gets .devcontainer-lock.json next to it', async () => {
    const built = await build(
      'c93-ac48',
      {features: {[runFeature('lab-plain')]: {}}},
      folder => {
        writeFileSync(
          path.join(folder, '.devcontainer.json'),
          // The same configuration, as a root file.
          JSON.stringify({
            image: variable('HARNESS_DEVCONTAINER_IMAGE'),
            runArgs: runLabelArguments(),
            features: {[runFeature('lab-plain')]: {}},
          }),
        );
        rmSync(path.join(folder, '.devcontainer'), {recursive: true});
      },
    );
    deepStrictEqual(
      [
        Object.keys(
          lockfileOf(built.folder, '.devcontainer-lock.json')?.features ?? {},
        ),
        lockfileOf(built.folder),
      ],
      [[runFeature('lab-plain')], undefined],
    );
  });

  it('F-0414 AC-51 (image-tags): an image configuration with a Feature makes the -features and the -features-uid image, runs the second, and with updateRemoteUserUID false only the first', async () => {
    await forgetImages('vsc-c93-ac51a');
    await forgetImages('vsc-c93-ac51b');
    const synced = await build(
      'c93-ac51a',
      {features: {'./user': {}}, remoteUser: 'worker'},
      writeUserFeature,
    );
    const names = (await imagesOf('vsc-c93-ac51a')).map(each =>
      each.replace(/-[0-9a-f]{8,}/, '-<hash>'),
    );
    const runs = await inspected(synced.containerId, '{{.Config.Image}}');
    const unsynced = await build(
      'c93-ac51b',
      {
        features: {'./user': {}},
        remoteUser: 'worker',
        updateRemoteUserUID: false,
      },
      writeUserFeature,
    );
    deepStrictEqual(
      [
        names,
        runs.replace(/-[0-9a-f]{8,}/, '-<hash>'),
        (await imagesOf('vsc-c93-ac51b')).map(each =>
          each.replace(/-[0-9a-f]{8,}/, '-<hash>'),
        ),
        (await inspected(unsynced.containerId, '{{.Config.Image}}')).replace(
          /-[0-9a-f]{8,}/,
          '-<hash>',
        ),
      ],
      [
        ['vsc-c93-ac51a-<hash>-features', 'vsc-c93-ac51a-<hash>-features-uid'],
        'vsc-c93-ac51a-<hash>-features-uid',
        ['vsc-c93-ac51b-<hash>-features'],
        'vsc-c93-ac51b-<hash>-features',
      ],
    );
  });

  it('F-0414 AC-52 (dockerfile-tags): a Dockerfile configuration with a Feature builds into vsc-<name>-<hash>, runs the -uid image, and makes no -features image', async () => {
    await forgetImages('vsc-c93-ac52');
    const built = await build(
      'c93-ac52',
      {
        image: undefined,
        build: {dockerfile: 'Dockerfile'},
        features: {'./user': {}},
        remoteUser: 'worker',
      },
      folder => {
        writeFileSync(
          path.join(folder, '.devcontainer', 'Dockerfile'),
          `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\n`,
        );
        writeUserFeature(folder);
      },
    );
    function strip(image: string): string {
      return image.replace(/-[0-9a-f]{8,}/, '-<hash>');
    }
    deepStrictEqual(
      [
        (await imagesOf('vsc-c93-ac52')).map(strip),
        strip(await inspected(built.containerId, '{{.Config.Image}}')),
      ],
      [
        ['vsc-c93-ac52-<hash>', 'vsc-c93-ac52-<hash>-uid'],
        'vsc-c93-ac52-<hash>-uid',
      ],
    );
  });
});
