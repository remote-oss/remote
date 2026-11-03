import {deepStrictEqual} from 'node:assert';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {closeWindow, reopenInContainer, variable} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {dialogOf, statusItem} from '../windows/renderer.ts';
import {
  removeComposeContainers,
  serviceContainerOf,
} from '../windows/compose-support.ts';
import {
  COMPOSE_STOP_WINDOW,
  eventsSince,
  lifecycleEvents,
  type Outcome,
  stayedRunning,
  stoppedWithin,
  watched,
} from './support.ts';

/** The services of the shared project and the windows that connect to it. */
const SERVICES = ['app', 'db'] as const;
const WINDOWS = ['first', 'second'] as const;

/** One window of the shared project: the service it connects to and what its configuration adds. */
type WindowName = (typeof WINDOWS)[number];

/** How long a close is watched when nothing is to stop, in seconds. */
const QUIET_SECONDS = 42;
/** How long a close that stops something is watched, in seconds. */
const STOP_SECONDS = 20;

/**
 * Writes a Compose project `project` whose services all mount both windows' folders, and the two folders
 * `<project>-first` and `<project>-second`, each with a configuration of its own service, and gives the folders.
 */
function sharedProject(
  project: string,
  extra: (service: string) => Readonly<Record<string, unknown>>,
): Record<WindowName, string> {
  const root = path.join(variable('HARNESS_RUN_FOLDER'), project);
  const folders = {
    first: path.join(root, `${project}-first`),
    second: path.join(root, `${project}-second`),
  };
  mkdirSync(root, {recursive: true});
  const mounts = WINDOWS.map(
    window => `      - "${folders[window]}:/workspaces/${project}-${window}"`,
  );
  const labels = [
    '    labels:',
    `      - "remote-oss.acceptance.run=${variable('HARNESS_RUN_ID')}"`,
    '      - "remote-oss.acceptance.devcontainer=1"',
  ];
  const composeFile = path.join(root, 'docker-compose.yml');
  writeFileSync(
    composeFile,
    [
      `name: ${project}`,
      'services:',
      ...SERVICES.flatMap(service => [
        `  ${service}:`,
        `    image: ${variable('HARNESS_DEVCONTAINER_IMAGE')}`,
        '    command: sleep infinity',
        '    volumes:',
        ...mounts,
        ...labels,
      ]),
      '',
    ].join('\n'),
  );
  WINDOWS.forEach((window, position) => {
    const folder = folders[window];
    mkdirSync(path.join(folder, '.devcontainer'), {recursive: true});
    writeFileSync(
      path.join(folder, '.devcontainer', 'devcontainer.json'),
      JSON.stringify({
        name: `${project}-${window}`,
        dockerComposeFile: path.relative(
          path.join(folder, '.devcontainer'),
          composeFile,
        ),
        service: SERVICES[position],
        workspaceFolder: `/workspaces/${project}-${window}`,
        ...extra(SERVICES[position] ?? 'app'),
      }),
    );
  });
  return folders;
}

/** Whether window `name` still shows a Dev Container indicator and no dialog. */
async function stillConnected(name: string): Promise<boolean> {
  return (
    (await statusItem(name, 'status.host')).text.startsWith('Dev Container') &&
    (await dialogOf(name)) === undefined
  );
}

/** What two windows of one project show after they close in an order. */
interface TwoWindows {
  /** After the first close, per service: the outcome of its container over the watch. */
  afterFirst: Outcome[];
  /** Whether the window that stayed open still showed a connection after the first watch. */
  otherConnected: boolean;
  /** After the second close, per service. */
  afterSecond: Outcome[];
  /** The kill, stop, die and start events of each container over the whole run after the first close. */
  events: string[][];
}

/**
 * Opens both windows of project `project` (the second one on a project the first one started), closes the one named
 * `first`, watches the containers for `firstSeconds`, then closes the other and watches for `STOP_SECONDS`.
 */
async function twoWindowsClosed(
  project: string,
  extra: (service: string) => Readonly<Record<string, unknown>>,
  first: WindowName,
  firstSeconds: number,
): Promise<TwoWindows> {
  const folders = sharedProject(project, extra);
  const names = {
    first: await openFolderWindow(folders.first),
    second: await openFolderWindow(folders.second),
  };
  await reopenInContainer(names.first);
  await reopenInContainer(names.second);
  const containers = await Promise.all(
    SERVICES.map(service => serviceContainerOf(project, service)),
  );
  const other = first === 'first' ? 'second' : 'first';
  await closeWindow(names[first]);
  const firstBegan = Date.now();
  const afterFirst = await Promise.all(
    containers.map(containerId =>
      watched(containerId, firstSeconds, firstBegan),
    ),
  );
  const otherConnected = await stillConnected(names[other]);
  await closeWindow(names[other]);
  const secondBegan = Date.now();
  const afterSecond = await Promise.all(
    containers.map(containerId =>
      watched(containerId, STOP_SECONDS, secondBegan),
    ),
  );
  const events = await Promise.all(
    containers.map(async containerId =>
      lifecycleEvents(await eventsSince(containerId, firstBegan)),
    ),
  );
  return {afterFirst, otherConnected, afterSecond, events};
}

/** The outcome at `index`; the rows always have both containers. */
function outcomeAt(outcomes: readonly Outcome[], index: number): Outcome {
  const outcome = outcomes[index];
  if (outcome === undefined) {
    throw new Error(`no container at ${String(index)}`);
  }
  return outcome;
}

describe('what closing one of two windows of a Compose project does (card containers-144)', function () {
  this.timeout(900_000);

  afterEach(async () => {
    await removeComposeContainers();
  });

  for (const first of WINDOWS) {
    const other = first === 'first' ? 'second' : 'first';
    it(`F-0417 AC-16, AC-38 (c144-two-${first}-first): closing the ${first} window stops nothing for 40 seconds and leaves the ${other} window connected, and the last close kills every container 11 to 17 seconds later`, async () => {
      const result = await twoWindowsClosed(
        `c144-two-${first}`,
        () => ({}),
        first,
        QUIET_SECONDS,
      );
      deepStrictEqual(
        {
          quiet: result.afterFirst.map(stayedRunning),
          otherConnected: result.otherConnected,
          killed: result.afterSecond.map(outcome =>
            stoppedWithin(outcome, 137, COMPOSE_STOP_WINDOW),
          ),
        },
        {quiet: [true, true], otherConnected: true, killed: [true, true]},
      );
    });
  }

  for (const first of WINDOWS) {
    const firstIndex = WINDOWS.indexOf(first);
    const otherIndex = 1 - firstIndex;
    it(`F-0417 AC-39, AC-40 (c144-own-${first}-first): with runServices naming only its own service, closing the ${first} window kills only its container, and the other window's close kills the other`, async () => {
      const result = await twoWindowsClosed(
        `c144-own-${first}`,
        service => ({runServices: [service]}),
        first,
        STOP_SECONDS,
      );
      deepStrictEqual(
        {
          firstKilled: stoppedWithin(
            outcomeAt(result.afterFirst, firstIndex),
            137,
            COMPOSE_STOP_WINDOW,
          ),
          otherUp: stayedRunning(outcomeAt(result.afterFirst, otherIndex)),
          otherConnected: result.otherConnected,
          otherKilled: stoppedWithin(
            outcomeAt(result.afterSecond, otherIndex),
            137,
            COMPOSE_STOP_WINDOW,
          ),
        },
        {
          firstKilled: true,
          otherUp: true,
          otherConnected: true,
          otherKilled: true,
        },
      );
    });
  }

  it('F-0417 AC-18 (c144-two-none): with shutdownAction none in both configurations no container stops through either close, and Docker shows no kill or stop', async () => {
    const result = await twoWindowsClosed(
      'c144-two-none',
      () => ({shutdownAction: 'none'}),
      'first',
      QUIET_SECONDS,
    );
    deepStrictEqual(
      {
        quiet: result.afterFirst.map(stayedRunning),
        otherConnected: result.otherConnected,
        stillUp: result.afterSecond.map(stayedRunning),
        events: result.events,
      },
      {
        quiet: [true, true],
        otherConnected: true,
        stillUp: [true, true],
        events: [[], []],
      },
    );
  });
});
