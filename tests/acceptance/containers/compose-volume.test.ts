import {deepStrictEqual} from 'node:assert';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {closeWindow, reopenStarted, variable} from '../windows/harness.ts';
import {openFolderWindow, setUserSetting} from '../windows/folder-windows.ts';
import {pressEscape, statusItem, waitForDialog} from '../windows/renderer.ts';
import {
  composeContainersOfRun,
  composeFolder,
  dockerRun,
  openedCompose,
  removeComposeContainers,
  volumeNamesOf,
} from '../windows/compose-support.ts';

/** What `docker inspect` says of one mount. */
interface InspectedMount {
  Name?: string;
  Destination: string;
  Mode: string;
  RW: boolean;
}

/** The mounts of container `containerId`. */
async function mountsOf(containerId: string): Promise<InspectedMount[]> {
  return JSON.parse(
    await dockerRun('inspect', '--format', '{{json .Mounts}}', containerId),
  ) as InspectedMount[];
}

/** The names of all volumes the engine holds, sorted. */
async function allVolumes(): Promise<string[]> {
  return (await dockerRun('volume', 'ls', '--quiet'))
    .split('\n')
    .filter(line => line !== '')
    .sort();
}

/** The creation time of the `vscode` volume `volume`, or nothing when the engine holds none. */
async function createdAtOf(volume: string): Promise<string | undefined> {
  try {
    return (
      await dockerRun('volume', 'inspect', '--format', '{{.CreatedAt}}', volume)
    ).trim();
  } catch {
    return undefined;
  }
}

/** A Compose folder whose primary service `app` mounts the volume `cache` at `/vscode/cache`. */
function reservedVolumeFolder(name: string): string {
  const folder = composeFolder({name, place: 'devcontainer'});
  const labels = [
    `remote-oss.acceptance.run=${variable('HARNESS_RUN_ID')}`,
    'remote-oss.acceptance.devcontainer=1',
  ]
    .map(label => `      - "${label}"`)
    .join('\n');
  mkdirSync(path.join(folder, '.devcontainer'), {recursive: true});
  writeFileSync(
    path.join(folder, '.devcontainer', 'docker-compose.yml'),
    [
      'services:',
      '  app:',
      `    image: ${variable('HARNESS_DEVCONTAINER_IMAGE')}`,
      '    command: sleep infinity',
      '    volumes:',
      `      - "..:/workspaces/${name}"`,
      '      - "cache:/vscode/cache"',
      '    labels:',
      labels,
      'volumes:',
      '  cache: {}',
      '',
    ].join('\n'),
  );
  return folder;
}

describe('the vscode volume of a Compose project (card containers-143, part D)', function () {
  this.timeout(600_000);

  afterEach(async () => {
    await removeComposeContainers();
    await setUserSetting('dev.containers.cacheVolume', undefined);
  });

  it('F-0419 AC-8, AC-21 (c143-volume): the service mounts the shared vscode volume read-write at /vscode and the project makes no volume of that name, also when the project declares a volume named vscode for /data', async () => {
    const plain = await openedCompose(
      composeFolder({name: 'c143-volume', place: 'devcontainer'}),
    );
    const plainMount = (await mountsOf(plain.containerId)).find(
      mount => mount.Destination === '/vscode',
    );
    const plainVolumes = await volumeNamesOf(plain.project);
    await closeWindow(plain.name);
    await removeComposeContainers();

    const own = await openedCompose(
      composeFolder({
        name: 'c143-volume-own',
        place: 'devcontainer',
        namedVolume: 'vscode',
      }),
    );
    const ownMounts = await mountsOf(own.containerId);
    await closeWindow(own.name);

    deepStrictEqual(
      {
        plain: [plainMount?.Name, plainMount?.Mode, plainMount?.RW],
        plainVolumes,
        ownShared: ownMounts.find(mount => mount.Destination === '/vscode')
          ?.Name,
      },
      {
        plain: ['vscode', 'rw', true],
        plainVolumes: [],
        ownShared: 'vscode',
      },
    );
  });

  it('F-0419 AC-20 (c143-reserved): a mounts entry at /vscode, and a service volume below it, each end the connect with a dialog that names the property, leave the window not connected, and create no container and no volume', async () => {
    const cases = [
      {
        folder: composeFolder({
          name: 'c143-reserved-mounts',
          place: 'devcontainer',
          configuration: {
            mounts: ['type=volume,source=extra,target=/vscode/x'],
          },
        }),
        text: "'mounts' mounts '/vscode/x': '/vscode' and the paths below it are reserved for the cache volume while dev.containers.cacheVolume is true.",
      },
      {
        folder: reservedVolumeFolder('c143-reserved-volumes'),
        text: "'services.app.volumes' mounts '/vscode/cache': '/vscode' and the paths below it are reserved for the cache volume while dev.containers.cacheVolume is true.",
      },
    ];
    const volumesBefore = await allVolumes();
    const found = [];
    for (const {folder} of cases) {
      const name = await openFolderWindow(folder);
      await reopenStarted(name);
      const dialog = await waitForDialog(name, 180_000);
      await pressEscape(name);
      // A connected window's indicator names the container ("Dev Container: <name>"); a failed one does not.
      const connected = (await statusItem(name, 'status.host')).text.includes(
        'Dev Container: ',
      );
      await closeWindow(name);
      found.push({
        details: dialog.details,
        connected,
        containers: await composeContainersOfRun(),
        newVolumes: (await allVolumes()).filter(
          volume => !volumesBefore.includes(volume),
        ),
      });
    }
    deepStrictEqual(
      found,
      cases.map(({text}) => ({
        details: text,
        connected: false,
        containers: [],
        newVolumes: [],
      })),
    );
  });

  it('F-0419 AC-34 (c143-cache-off): with cacheVolume false the service container has no mount at /vscode and the vscode volume is as it was', async () => {
    await setUserSetting('dev.containers.cacheVolume', false);
    const createdBefore = await createdAtOf('vscode');
    const opened = await openedCompose(
      composeFolder({name: 'c143-cache-off', place: 'devcontainer'}),
    );
    const destinations = (await mountsOf(opened.containerId)).map(
      mount => mount.Destination,
    );
    const createdAfter = await createdAtOf('vscode');
    await closeWindow(opened.name);
    deepStrictEqual(
      [
        destinations.filter(destination => destination.startsWith('/vscode')),
        createdAfter,
      ],
      [[], createdBefore],
    );
  });
});
