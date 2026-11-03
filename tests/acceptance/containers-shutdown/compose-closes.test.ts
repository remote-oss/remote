import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {closeWindow, variable} from '../windows/harness.ts';
import {
  composeFolder,
  composeNetworks,
  dockerRun,
  openedCompose,
  removeComposeContainers,
  serviceContainerOf,
} from '../windows/compose-support.ts';
import {
  COMPOSE_STOP_WINDOW,
  eventsSince,
  lifecycleEvents,
  stayedRunning,
  stoppedWithin,
  watched,
} from './support.ts';

/** The labels that make the run's clean-up find a service's container. */
function runLabels(): string[] {
  return [
    '    labels:',
    `      - "remote-oss.acceptance.run=${variable('HARNESS_RUN_ID')}"`,
    '      - "remote-oss.acceptance.devcontainer=1"',
  ];
}

/** The text of a compose file with the services `app` (depending on `db`), `db` and `other`, all from the run's image. */
function threeServices(name: string): string {
  const image = `    image: ${variable('HARNESS_DEVCONTAINER_IMAGE')}`;
  return [
    'services:',
    '  app:',
    image,
    '    command: sleep infinity',
    '    depends_on: [db]',
    '    volumes:',
    `      - "..:/workspaces/${name}"`,
    ...runLabels(),
    '  db:',
    image,
    '    command: sleep infinity',
    ...runLabels(),
    '  other:',
    image,
    '    command: sleep infinity',
    ...runLabels(),
    '',
  ].join('\n');
}

describe('what closing a Compose window does to its project (card containers-144)', function () {
  this.timeout(600_000);

  afterEach(async () => {
    await removeComposeContainers();
  });

  it('F-0417 AC-10, F-0413 AC-24 (c144-close): closing the only window kills every service container 11 to 17 seconds later with exit 137, and removes nothing', async () => {
    const opened = await openedCompose(
      composeFolder({name: 'c144-close', place: 'devcontainer'}),
    );
    const containers = [
      opened.containerId,
      await serviceContainerOf(opened.project, 'db'),
    ];
    const networks = await composeNetworks();
    await closeWindow(opened.name);
    const began = Date.now();
    const outcomes = await Promise.all(
      containers.map(containerId => watched(containerId, 22, began)),
    );
    deepStrictEqual(
      {
        killed: outcomes.map(outcome =>
          stoppedWithin(outcome, 137, COMPOSE_STOP_WINDOW),
        ),
        present: (
          await Promise.all(
            containers.map(containerId =>
              dockerRun('inspect', '--format', '{{.Id}}', containerId),
            ),
          )
        ).map(full => full.slice(0, 12)),
        networksKept: (await composeNetworks()).length === networks.length,
      },
      {
        killed: [true, true],
        present: containers.map(full => full.slice(0, 12)),
        networksKept: true,
      },
    );
  });

  it('F-0413 AC-6, AC-68, F-0417 AC-13 (c144-scope): runServices app, which depends on db, starts no third service; the close kills app 11 to 17 seconds later while db and a service started by hand stay up', async () => {
    const folder = composeFolder({
      name: 'c144-scope',
      place: 'devcontainer',
      composeText: threeServices('c144-scope'),
      configuration: {runServices: ['app']},
    });
    const opened = await openedCompose(folder);
    const dbContainer = await serviceContainerOf(opened.project, 'db');
    const absentBefore = await serviceContainerOf(opened.project, 'other');
    await dockerRun(
      'compose',
      '--file',
      path.join(folder, '.devcontainer', 'docker-compose.yml'),
      '--project-name',
      opened.project,
      'up',
      '--detach',
      '--no-deps',
      'other',
    );
    const other = await serviceContainerOf(opened.project, 'other');
    await closeWindow(opened.name);
    const began = Date.now();
    const [appOutcome, dbOutcome, otherOutcome] = await Promise.all([
      watched(opened.containerId, 17, began),
      watched(dbContainer, 60, began),
      watched(other, 60, began),
    ]);
    deepStrictEqual(
      {
        absentBefore,
        appKilled: stoppedWithin(appOutcome, 137, COMPOSE_STOP_WINDOW),
        dbUp: stayedRunning(dbOutcome),
        handUp: stayedRunning(otherOutcome),
      },
      {absentBefore: '', appKilled: true, dbUp: true, handUp: true},
    );
  });

  it('F-0417 AC-4 (c144-none): with shutdownAction none every container of the project stays up for 60 seconds after the close, with no kill, stop or die event', async () => {
    const opened = await openedCompose(
      composeFolder({
        name: 'c144-none',
        place: 'devcontainer',
        configuration: {shutdownAction: 'none'},
      }),
    );
    const containers = [
      opened.containerId,
      await serviceContainerOf(opened.project, 'db'),
    ];
    await closeWindow(opened.name);
    const began = Date.now();
    const outcomes = await Promise.all(
      containers.map(containerId => watched(containerId, 60, began)),
    );
    const events = await Promise.all(
      containers.map(async containerId =>
        lifecycleEvents(await eventsSince(containerId, began)),
      ),
    );
    deepStrictEqual(
      {running: outcomes.map(stayedRunning), events},
      {running: [true, true], events: [[], []]},
    );
  });
});
