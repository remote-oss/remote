import {execFile} from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  reopenInContainer,
  variable,
} from '../windows/harness.ts';
import {runTemplatesReady} from '../windows/run-templates.ts';

const execFileAsync = promisify(execFile);

/** How long a build with Features may take, in milliseconds. */
const BUILD_MILLISECONDS = 600_000;

/** The id of one of the run's own Features, as the registry the CLI pulls from names it. */
export function runFeature(feature: string): string {
  return `${variable('HARNESS_TEMPLATE_REGISTRY')}/remote-oss-run/features/${feature}:1`;
}

/** What a local Feature of a row holds: the options its metadata declares and the lines its script runs. */
export interface LocalFeature {
  /** The members of `devcontainer-feature.json` besides `id` and `version`. */
  metadata?: Readonly<Record<string, unknown>>;
  /** The body of `install.sh`, after the line that records the environment. */
  script?: string;
}

/**
 * Writes the Feature `name` under the folder's `.devcontainer`: a metadata file and a script that records its
 * environment in `/usr/local/share/remote-oss-run/<name>.env` before it runs `script`.
 */
export function writeLocalFeature(
  folder: string,
  name: string,
  feature: LocalFeature = {},
): void {
  const place = path.join(folder, '.devcontainer', name);
  mkdirSync(place, {recursive: true});
  writeFileSync(
    path.join(place, 'devcontainer-feature.json'),
    JSON.stringify({id: name, version: '1.0.0', name, ...feature.metadata}),
  );
  const script = path.join(place, 'install.sh');
  writeFileSync(
    script,
    `#!/bin/sh\nset -e\nmkdir -p /usr/local/share/remote-oss-run\nenv > /usr/local/share/remote-oss-run/${name}.env\n${feature.script ?? ''}\n`,
  );
  chmodSync(script, 0o755);
}

/** A built container: its window, its folder and its id. */
export interface Built {
  window: string;
  folder: string;
  containerId: string;
}

/**
 * Called inside a `describe`: closes the windows and removes the containers its `build` made after each row. `build`
 * writes the folder's configuration (and any local Feature through `prepare`), opens the folder in a window and runs
 * Reopen in Container.
 */
export function featureBuilds(): {
  build: (
    name: string,
    configuration: Readonly<Record<string, unknown>>,
    prepare?: (folder: string) => void,
  ) => Promise<Built>;
  closeNow: (window: string) => Promise<void>;
  reopen: (built: Built, removeContainer: boolean) => Promise<Built>;
} {
  const opened: string[] = [];
  const folders: string[] = [];
  afterEach(async () => {
    for (const window of opened.splice(0)) {
      await closeWindow(window);
    }
    for (const folder of folders.splice(0)) {
      await removeContainers(folder);
    }
  });
  return {
    build: async (name, configuration, prepare) => {
      await runTemplatesReady();
      const folder = devContainerFolder(name, configuration);
      folders.push(folder);
      prepare?.(folder);
      const window = await openFolderWindow(folder);
      opened.push(window);
      await reopenInContainer(window, BUILD_MILLISECONDS);
      const [containerId = ''] = await devContainersOf(folder);
      return {window, folder, containerId};
    },
    closeNow: async window => {
      opened.splice(opened.indexOf(window), 1);
      await closeWindow(window);
    },
    reopen: async (built, removeContainer) => {
      opened.splice(opened.indexOf(built.window), 1);
      await closeWindow(built.window);
      if (removeContainer) {
        await removeContainers(built.folder);
      }
      const window = await openFolderWindow(built.folder);
      opened.push(window);
      await reopenInContainer(window, BUILD_MILLISECONDS);
      const [containerId = ''] = await devContainersOf(built.folder);
      return {window, folder: built.folder, containerId};
    },
  };
}

/** The environment a Feature recorded in the container, by variable. */
export async function environmentOf(
  containerId: string,
  feature: string,
): Promise<Record<string, string>> {
  const {stdout} = await execFileAsync('docker', [
    'exec',
    containerId,
    'cat',
    `/usr/local/share/remote-oss-run/${feature}.env`,
  ]);
  return Object.fromEntries(
    stdout
      .split('\n')
      .filter(line => line.includes('='))
      .map(line => [
        line.slice(0, line.indexOf('=')),
        line.slice(line.indexOf('=') + 1),
      ]),
  );
}

/** The entries of the `devcontainer.metadata` label of the container, in order. */
export async function metadataOf(
  containerId: string,
): Promise<Array<Record<string, unknown>>> {
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '--format',
    '{{ index .Config.Labels "devcontainer.metadata" }}',
    containerId,
  ]);
  return JSON.parse(stdout) as Array<Record<string, unknown>>;
}

/** The lockfile next to the configuration, or nothing when there is none. */
export function lockfileOf(
  folder: string,
  name = path.join('.devcontainer', 'devcontainer-lock.json'),
): {features: Record<string, Record<string, unknown>>} | undefined {
  const file = path.join(folder, name);
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as {
        features: Record<string, Record<string, unknown>>;
      })
    : undefined;
}

/** `docker inspect` of the container (or image) with a Go template, as text. */
export async function inspected(
  subject: string,
  template: string,
): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '--format',
    template,
    subject,
  ]);
  return stdout.trim();
}

/** The tags of the images named `<prefix>-<hash>…` the build of a folder made, sorted. */
export async function imagesOf(prefix: string): Promise<string[]> {
  const {stdout} = await execFileAsync('docker', [
    'image',
    'ls',
    '--format',
    '{{.Repository}}',
    '--filter',
    `reference=${prefix}-*`,
  ]);
  return [...new Set(stdout.split('\n').filter(line => line !== ''))].sort();
}

/** The file inside the container, as text. */
export async function readIn(
  containerId: string,
  file: string,
): Promise<string> {
  const {stdout} = await execFileAsync('docker', [
    'exec',
    containerId,
    'cat',
    file,
  ]);
  return stdout;
}

/** Removes the images named `<prefix>-*`, which earlier runs of the same row left. */
export async function forgetImages(prefix: string): Promise<void> {
  const {stdout} = await execFileAsync('docker', [
    'image',
    'ls',
    '--quiet',
    '--filter',
    `reference=${prefix}-*`,
  ]);
  const imageIds = [...new Set(stdout.split('\n').filter(line => line !== ''))];
  if (imageIds.length > 0) {
    await execFileAsync('docker', ['image', 'rm', '--force', ...imageIds]);
  }
}
