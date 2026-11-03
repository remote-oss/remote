import {deepStrictEqual} from 'node:assert';
import {closeWindow, listenIn} from '../windows/harness.ts';
import {notificationCentre} from '../windows/renderer.ts';
import {
  composeFolder,
  dockerRun,
  openedCompose,
  removeComposeContainers,
  serviceContainerOf,
  serviceLines,
} from '../containers/compose-support.ts';
import {
  echoes,
  freePort,
  listenInTerminal,
  rowsWhen,
  showPorts,
} from './ports-support.ts';

/** The text of a compose file whose services are `app` (with `appExtra` lines) and `db` (with `dbExtra` lines). */
function composeText(
  name: string,
  appExtra: readonly string[],
  dbExtra: readonly string[] = [],
): string {
  return [
    'services:',
    ...serviceLines('app', [
      '    volumes:',
      `      - "..:/workspaces/${name}"`,
      ...appExtra,
    ]),
    ...serviceLines('db', dbExtra),
    '',
  ].join('\n');
}

/** The ports `docker inspect` reports as published for container `containerId`, as `<container port>/tcp` keys. */
async function publishedKeys(containerId: string): Promise<string[]> {
  const published = JSON.parse(
    await dockerRun(
      'inspect',
      '--format',
      '{{json .NetworkSettings.Ports}}',
      containerId,
    ),
  ) as Record<string, unknown>;
  return Object.keys(published).sort();
}

describe('the ports of a Docker Compose dev container (card containers-146)', function () {
  this.timeout(900_000);

  afterEach(async () => {
    await removeComposeContainers();
  });

  it('F-1101 AC-4 (c146-forward): forwardPorts "db:5432" names the other service on the Compose network; the row reads db:5432 and the port is reachable from the host', async () => {
    const folder = composeFolder({
      name: 'c146-forward',
      place: 'devcontainer',
      configuration: {forwardPorts: ['db:5432']},
    });
    const {name, project} = await openedCompose(folder);
    try {
      const stop = await listenIn(
        await serviceContainerOf(project, 'db'),
        5432,
      );
      await showPorts(name);
      const rows = await rowsWhen(name, shown => shown.length > 0);
      const forwarded = rows.find(each => each.port === 'db:5432');
      const reachable =
        forwarded === undefined
          ? false
          : await echoes(forwarded.forwardedAddress);
      await stop();
      deepStrictEqual(
        [rows.map(each => each.port), reachable],
        [['db:5432'], true],
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-1101 AC-19, AC-27 (c146-published): the compose ports: mapping is the one Statically Forwarded row, shown on [::1] at its host port, and the appPort and the matching portsAttributes change nothing and show no error', async () => {
    const [host, container, ignored] = [
      await freePort(),
      await freePort(),
      await freePort(),
    ];
    const folder = composeFolder({
      name: 'c146-published',
      place: 'devcontainer',
      composeText: composeText('c146-published', [
        '    ports:',
        `      - "${String(host)}:${String(container)}"`,
      ]),
      configuration: {
        appPort: [ignored],
        portsAttributes: {[String(container)]: {label: 'Web'}},
        otherPortsAttributes: {label: 'Other'},
      },
    });
    const {name, containerId} = await openedCompose(folder);
    try {
      await showPorts(name);
      const rows = await rowsWhen(name, shown => shown.length > 0);
      await new Promise(resolve => setTimeout(resolve, 5000));
      deepStrictEqual(
        {
          published: await publishedKeys(containerId),
          rows: rows.map(each => [
            each.port,
            each.origin,
            each.forwardedAddress,
            each.runningProcess,
          ]),
          errors: (await notificationCentre(name)).filter(text =>
            /error|failed/i.test(text),
          ),
        },
        {
          published: [`${String(container)}/tcp`],
          rows: [
            [
              String(container),
              'Statically Forwarded',
              `[::1]:${String(host)}`,
              '',
            ],
          ],
          errors: [],
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  /** A window on a Compose project whose other service listens: only the attached container’s own listener gets a row. */
  async function autoForwarded(
    label: string,
    otherService: readonly string[],
  ): Promise<void> {
    const [other, own] = [await freePort(), await freePort()];
    const folder = composeFolder({
      name: label,
      place: 'devcontainer',
      composeText: composeText(label, [], otherService),
    });
    const {name, project} = await openedCompose(folder);
    try {
      const dbContainer = await serviceContainerOf(project, 'db');
      const stopOther = await listenIn(dbContainer, other);
      const stopOwn = await listenInTerminal(
        name,
        await serviceContainerOf(project, 'app'),
        own,
      );
      await showPorts(name);
      await new Promise(resolve => setTimeout(resolve, 20_000));
      const rows = await rowsWhen(name, shown => shown.length > 0);
      await stopOwn();
      await stopOther();
      deepStrictEqual(
        rows.map(each => [each.port, each.origin]),
        [[String(own), 'Auto Forwarded']],
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  }

  it('F-1102 AC-26 (c146-auto): a port listened on in the other service is never auto-forwarded, while one the attached container’s own process listens on is', async () => {
    await autoForwarded('c146-auto', []);
  });

  it('F-1102 AC-26 (c146-auto-shared): a port listened on in the other service, which shares the attached service’s network, is never auto-forwarded, while one the attached container’s own process listens on is', async () => {
    await autoForwarded('c146-auto-shared', [
      '    network_mode: "service:app"',
    ]);
  });
});
