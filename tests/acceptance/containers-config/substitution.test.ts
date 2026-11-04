import {deepStrictEqual} from 'node:assert';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {closeWindow} from '../windows/harness.ts';
import {connectedWindow, removeContainers} from '../windows/folder-windows.ts';
import {statusItemText, windowTitle} from '../windows/renderer.ts';
import {docker} from '../windows/dev-containers-view.ts';

/** The shortest time the indicator is given to follow a connect, in milliseconds. */
const INDICATOR_MILLISECONDS = 30_000;

/** The variables of a container's configured environment, by name. */
async function environmentOf(
  containerId: string,
): Promise<Record<string, string>> {
  const lines = JSON.parse(
    await docker('inspect', '--format', '{{json .Config.Env}}', containerId),
  ) as string[];
  return Object.fromEntries(
    lines.map(line => [
      line.slice(0, line.indexOf('=')),
      line.slice(line.indexOf('=') + 1),
    ]),
  );
}

/** The 52 characters the public computation gives for the id labels: base 32 of the SHA-256 of their sorted JSON. */
function devcontainerIdOf(labels: Readonly<Record<string, string>>): string {
  const sorted = Object.fromEntries(
    Object.entries(labels).sort(([first], [second]) =>
      first < second ? -1 : 1,
    ),
  );
  const digest = createHash('sha256')
    .update(JSON.stringify(sorted))
    .digest('hex');
  return BigInt(`0x${digest}`).toString(32).padStart(52, '0');
}

describe('Variable substitution in a connected dev container (card coverage-112)', function () {
  this.timeout(900_000);

  it('F-0304 AC-1, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-20, AC-21, AC-24, AC-41, AC-47, AC-48, AC-51, AC-59, AC-66 (c112-env): the references of containerEnv, mounts and name resolve as the spec gives them, and the resolved values reach Config.Env, the mounts, the title and the indicator', async () => {
    const label = 'c112-env';
    const {name, containerId, folder} = await connectedWindow(label, {
      name: `${label}-\${localWorkspaceFolderBasename}-\${localEnv:C112_EMPTY:dflt}`,
      containerEnv: {
        C112_HOME: '${localEnv:HOME}',
        C112_SET: '${localEnv:C112_SET:dflt}',
        C112_UNSET: '${localEnv:C112_UNSET:dflt}',
        C112_NODEFAULT: '${localEnv:C112_UNSET}',
        C112_NONAME: '${localEnv:}',
        C112_EXTRA: '${localEnv:C112_UNSET:a:b:c}',
        C112_BOGUS: '${bogusVariable}',
        C112_CONTAINER: '${containerEnv:PATH}',
        C112_ENV: '${env:C112_SET}',
        C112_NESTED: '${localEnv:C112_UNSET:${localEnv:HOME}}',
        C112_UPPER: '${LocalEnv:HOME}',
        C112_SPACED: '${ localEnv:HOME }',
        C112_LEADING: '${localEnv: HOME}',
        C112_BACKSLASH: '\\${localEnv:HOME}',
        C112_DOLLAR: '$${localEnv:HOME}',
        C112_BLANKDEFAULT: '${localEnv:C112_UNSET:}',
        C112_EMPTYSET: '${localEnv:C112_EMPTY:dflt}',
        C112_EMPTYENV: '${env:C112_EMPTY:dflt}',
        C112_ID: '${devcontainerId}',
      },
      mounts: [
        'type=volume,source=c112-${localWorkspaceFolderBasename},target=/c112-basename',
        {
          type: 'volume',
          source: 'c112-${devcontainerId}',
          target: '/c112-${localWorkspaceFolderBasename}',
        },
      ],
    });
    const home = process.env['HOME'] ?? '';
    const created: string[] = [];
    try {
      const environment = await environmentOf(containerId);
      const labels = JSON.parse(
        await docker(
          'inspect',
          '--format',
          '{{json .Config.Labels}}',
          containerId,
        ),
      ) as Record<string, string>;
      const mounts = JSON.parse(
        await docker('inspect', '--format', '{{json .Mounts}}', containerId),
      ) as Array<{Type: string; Name?: string; Destination: string}>;
      created.push(
        ...mounts.flatMap(mount =>
          mount.Type === 'volume' && mount.Name?.startsWith('c112-')
            ? [mount.Name]
            : [],
        ),
      );
      const identifier = environment['C112_ID'] ?? '';
      const expectedName = `${label}-${label}-dflt`;
      deepStrictEqual(
        {
          values: Object.fromEntries(
            Object.entries(environment).filter(([key]) =>
              key.startsWith('C112_'),
            ),
          ),
          identifier: [
            /^[0-9a-v]{52}$/.test(identifier),
            identifier ===
              devcontainerIdOf({
                'devcontainer.local_folder':
                  labels['devcontainer.local_folder'] ?? '',
                'devcontainer.config_file':
                  labels['devcontainer.config_file'] ?? '',
              }),
          ],
          volumes: mounts
            .filter(mount => created.includes(mount.Name ?? ''))
            .map(mount => [mount.Name, mount.Destination])
            .sort(),
          title: await windowTitle(name),
          indicator: await statusItemText(
            name,
            'status.host',
            `Dev Container: ${expectedName}`,
            INDICATOR_MILLISECONDS,
          ),
        },
        {
          values: {
            C112_HOME: home,
            C112_SET: 'from-host',
            C112_UNSET: 'dflt',
            C112_NODEFAULT: '',
            C112_NONAME: '',
            C112_EXTRA: 'a',
            C112_BOGUS: '${bogusVariable}',
            C112_CONTAINER: '${containerEnv:PATH}',
            C112_ENV: 'from-host',
            C112_NESTED: '${localEnv}',
            C112_UPPER: '${LocalEnv:HOME}',
            C112_SPACED: '${ localEnv:HOME }',
            C112_LEADING: '',
            C112_BACKSLASH: '\\',
            C112_DOLLAR: `$${home}`,
            C112_BLANKDEFAULT: '',
            C112_EMPTYSET: 'dflt',
            C112_EMPTYENV: 'dflt',
            C112_ID: identifier,
          },
          identifier: [true, true],
          volumes: [
            [`c112-${path.basename(folder)}`, '/c112-basename'],
            [`c112-${identifier}`, `/c112-${path.basename(folder)}`],
          ].sort(),
          title: `[${path.basename(folder)} [Dev Container: ${expectedName}]]`,
          indicator: `Dev Container: ${expectedName}`,
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder);
      if (created.length > 0) {
        await docker('volume', 'rm', '--force', ...created).catch(
          () => undefined,
        );
      }
    }
  });
});
