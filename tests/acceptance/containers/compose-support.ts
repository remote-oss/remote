/**
 * @fileoverview What the Compose rows share: a folder with a dev container configuration that names a compose file, in
 * a place the row chooses, and the reads of what its project made.
 */

import {execFile} from 'node:child_process';
import {chmodSync, mkdirSync, writeFileSync} from 'node:fs';
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
  /** The whole text of the compose file, in place of the two services. */
  composeText?: string;
  /** A named volume the `app` service mounts at `/data`, declared in the compose file. */
  namedVolume?: string;
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
    options.composeText ??
      [
        ...(options.headLines ?? []),
        'services:',
        ...serviceLines('app', [
          '    volumes:',
          `      - "${place.workspace}:/workspaces/${options.name}"`,
          ...(options.namedVolume === undefined
            ? []
            : [`      - ${options.namedVolume}:/data`]),
        ]),
        ...serviceLines('db'),
        ...(options.namedVolume === undefined
          ? []
          : ['volumes:', `  ${options.namedVolume}: {}`]),
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

/** Writes the executable `<run>/c143-bin/<name>` with `lines`, and gives its path. */
function programFile(name: string, lines: readonly string[]): string {
  return scriptAt(
    path.join(variable('HARNESS_RUN_FOLDER'), 'c143-bin', name),
    lines,
  );
}

/** Writes the executable `file` with `lines`, making its folder, and gives it back. */
export function scriptAt(file: string, lines: readonly string[]): string {
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, ['#!/bin/sh', ...lines, ''].join('\n'));
  chmodSync(file, 0o755);
  return file;
}

/** A Docker that works as the real one except that it has no Compose plugin. */
export function dockerWithoutPlugin(): string {
  return programFile('docker-no-plugin', [
    '[ "$1" = compose ] && exit 1',
    'exec docker "$@"',
  ]);
}

/**
 * A standalone Compose that reports `version` and otherwise runs the Docker plugin; it appends a line to `marker` for
 * each call, when the row gives one.
 */
export function standaloneCompose(
  name: string,
  version: string,
  marker?: string,
): string {
  return programFile(name, standaloneLines(version, marker));
}

/** The script of a standalone Compose that reports `version`. */
export function standaloneLines(
  version: string,
  marker?: string,
): readonly string[] {
  return [
    ...(marker === undefined ? [] : [`echo called >> '${marker}'`]),
    `[ "$1" = version ] && { echo '${version}'; exit 0; }`,
    'exec docker compose "$@"',
  ];
}

/** The names of the running containers of the Compose project `project`, sorted. */
export async function containerNamesOf(project: string): Promise<string[]> {
  return (
    await docker(
      'ps',
      '--filter',
      `label=com.docker.compose.project=${project}`,
      '--format',
      '{{.Names}}',
    )
  )
    .split('\n')
    .filter(line => line !== '')
    .sort();
}

/** The names of the volumes of the Compose project `project`, sorted. */
export async function volumeNamesOf(project: string): Promise<string[]> {
  return (
    await docker(
      'volume',
      'ls',
      '--filter',
      `label=com.docker.compose.project=${project}`,
      '--format',
      '{{.Name}}',
    )
  )
    .split('\n')
    .filter(line => line !== '')
    .sort();
}

/** The containers of Compose projects that the run made, running or not. */
export async function composeContainersOfRun(): Promise<string[]> {
  return (
    await docker(
      'ps',
      '--all',
      '--quiet',
      '--filter',
      'label=com.docker.compose.project',
      '--filter',
      `label=remote-oss.acceptance.run=${variable('HARNESS_RUN_ID')}`,
    )
  )
    .split('\n')
    .filter(line => line !== '');
}
