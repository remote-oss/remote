/**
 * @fileoverview What the Compose rows share: a folder with a dev container configuration that names a compose file, in
 * a place the row chooses, and the reads of what its project made.
 */

import {execFile} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  containersLog,
  devContainersOf,
  reopenInContainer,
  variable,
  withLogTail,
} from '../windows/harness.ts';
import {dialogOf} from '../windows/renderer.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';

const execFileAsync = promisify(execFile);

/** Where the compose file lies, below the workspace folder. */
export type ComposePlace = 'workspace' | 'devcontainer' | 'nested';

/** What a Compose folder is made of. */
export interface ComposeFolderOptions {
  /** The folder's name below the run folder; it is the workspace folder's name. */
  name: string;
  place: ComposePlace;
  /** Lines put before the `services:` of the compose file, such as a top-level `name:`. */
  headLines?: readonly string[];
  /** Lines of a second compose file, `override.yml` beside the first, which follows it in `dockerComposeFile`; only for a file in `.devcontainer/`. */
  overrideLines?: readonly string[];
  /** The content of `.env` beside the workspace folder's root, when the row has one. */
  workspaceEnv?: string;
  /** The content of the `.env` beside the compose file, when the row has one. */
  composeEnv?: string;
  /** Other members of the configuration, which win over the defaults. */
  configuration?: Readonly<Record<string, unknown>>;
}

/** The folder of the compose file below the workspace folder, the way the configuration names it, and the workspace as the file sees it. */
const PLACES: Readonly<
  Record<ComposePlace, {folder: string; reference: string; workspace: string}>
> = {
  workspace: {folder: '.', reference: '../docker-compose.yml', workspace: '.'},
  devcontainer: {
    folder: '.devcontainer',
    reference: 'docker-compose.yml',
    workspace: '..',
  },
  nested: {
    folder: '.devcontainer/app',
    reference: 'app/docker-compose.yml',
    workspace: '../..',
  },
};

/** The labels that make the run's clean-up find a service's container. */
function runLabels(): string {
  return [
    `remote-oss.acceptance.run=${variable('HARNESS_RUN_ID')}`,
    'remote-oss.acceptance.devcontainer=1',
  ]
    .map(label => `      - "${label}"`)
    .join('\n');
}

/** A service that does nothing, from the run's image, with the run's labels. */
function serviceLines(name: string, extra: readonly string[] = []): string[] {
  return [
    `  ${name}:`,
    `    image: ${variable('HARNESS_DEVCONTAINER_IMAGE')}`,
    '    command: sleep infinity',
    ...extra,
    '    labels:',
    runLabels(),
  ];
}

/** Writes the folder `<run>/<name>` with a two-service Compose configuration (`app` and `db`), and gives its path. */
export function composeFolder(options: ComposeFolderOptions): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), options.name);
  const place = PLACES[options.place];
  const composeFolder = path.join(folder, place.folder);
  mkdirSync(composeFolder, {recursive: true});
  mkdirSync(path.join(folder, '.devcontainer'), {recursive: true});
  writeFileSync(
    path.join(composeFolder, 'docker-compose.yml'),
    [
      ...(options.headLines ?? []),
      'services:',
      ...serviceLines('app', [
        '    volumes:',
        `      - "${place.workspace}:/workspaces/${options.name}"`,
      ]),
      ...serviceLines('db'),
      '',
    ].join('\n'),
  );
  if (options.overrideLines !== undefined) {
    writeFileSync(
      path.join(composeFolder, 'override.yml'),
      [...options.overrideLines, 'services: {}', ''].join('\n'),
    );
  }
  if (options.workspaceEnv !== undefined) {
    writeFileSync(path.join(folder, '.env'), options.workspaceEnv);
  }
  if (options.composeEnv !== undefined) {
    writeFileSync(path.join(composeFolder, '.env'), options.composeEnv);
  }
  writeFileSync(
    path.join(folder, '.devcontainer', 'devcontainer.json'),
    JSON.stringify({
      name: options.name,
      dockerComposeFile:
        options.overrideLines === undefined
          ? place.reference
          : [place.reference, 'override.yml'],
      service: 'app',
      workspaceFolder: `/workspaces/${options.name}`,
      ...options.configuration,
    }),
  );
  return folder;
}

/** What `docker` printed for `parameters`, trimmed. */
async function docker(...parameters: string[]): Promise<string> {
  const {stdout} = await execFileAsync('docker', parameters);
  return stdout.trim();
}

/** The Compose project of container `containerId`. */
async function projectOf(containerId: string): Promise<string> {
  return docker(
    'inspect',
    '-f',
    '{{index .Config.Labels "com.docker.compose.project"}}',
    containerId,
  );
}

/** The running services of the Compose project `project`, sorted. */
export async function runningServicesOf(project: string): Promise<string[]> {
  return (
    await docker(
      'ps',
      '--filter',
      `label=com.docker.compose.project=${project}`,
      '--format',
      '{{.Label "com.docker.compose.service"}}',
    )
  )
    .split('\n')
    .filter(line => line !== '')
    .sort();
}

/** Opens `folder` in its container and gives the window, the primary container and the project it belongs to. */
export async function openedCompose(
  folder: string,
): Promise<{name: string; containerId: string; project: string}> {
  const name = await openFolderWindow(folder);
  try {
    await reopenInContainer(name);
  } catch (caught) {
    throw new Error(
      withLogTail(
        `${caught instanceof Error ? caught.message : String(caught)}\ndialog: ${JSON.stringify(await dialogOf(name).catch(() => 'unreadable'))}`,
        containersLog(),
      ),
      {cause: caught},
    );
  }
  const [containerId = ''] = await devContainersOf(folder);
  return {name, containerId, project: await projectOf(containerId)};
}

/** Removes the run's containers of Compose projects and the networks nothing uses. */
export async function removeComposeContainers(): Promise<void> {
  const containers = await docker(
    'ps',
    '--all',
    '--quiet',
    '--filter',
    'label=com.docker.compose.project',
    '--filter',
    `label=remote-oss.acceptance.run=${variable('HARNESS_RUN_ID')}`,
  );
  if (containers !== '') {
    await docker('rm', '--force', ...containers.split('\n'));
  }
  await docker('network', 'prune', '--force');
}
