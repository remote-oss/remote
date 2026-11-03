/**
 * @fileoverview The Details (Containers) view as a pure tree: the facts `docker inspect` gives of one container
 * go in, and the section title, the Attributes and Mounts sections and their rows come out. No editor, engine or file
 * is touched here.
 */

import {
  configFileOf,
  devContainerFolderOf,
  localFolderOf,
} from '../lifecycle/labels.ts';
import {filled} from '../surfaces/filled.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {labelsOf, recordOf} from './listed-containers.ts';
import {folderNameOf} from './targets-model.ts';

/** The English template of each text of the tree, by its string id. */
const DETAILS_TEMPLATES = {
  S043: 'Attributes',
  S045: 'Bind mount',
  S080: 'Configuration',
  S109: 'Destination',
  S199: 'I/O performance',
  S202: 'Image',
  S228: 'Mounts',
  S229: 'Name',
  S330: 'Source',
  S425: 'reduced by bridging OSes',
  S393: 'Volume',
  S396: 'Volume mount',
  /** An `[adaptation]` key: its string id is not given yet. */
  workspaceOrigin: 'Workspace',
} as const;

/** One mount of the container, as the view reads it. */
type ShownMount =
  | {type: 'volume'; name: string; destination: string}
  | {type: 'bind'; source: string; destination: string};

/** The container the section shows, with what the view reads of it. */
export interface ShownContainer {
  id: string;
  /** The container's name as Docker keeps it, with the leading slash. */
  name: string;
  /** `Config.Image`: the image as the container was created. */
  image: string;
  labels: Readonly<Record<string, string>>;
  /** The mounts in the order Docker lists them. */
  mounts: readonly ShownMount[];
}

/** One row of the tree. */
export interface DetailsRow {
  id: string;
  label: string;
  description: string;
  viewItem: string | undefined;
  /** The hover text; none leaves it to the editor. */
  tooltip?: string;
  children: readonly DetailsRow[];
}

/** The section's title and its sections. */
export interface DetailsTree {
  title: string;
  sections: readonly DetailsRow[];
}

/** The volume and bind mounts of Docker's mount list, in its order; other kinds and malformed entries are left out. */
function mountsOf(value: unknown): ShownMount[] {
  const shown: ShownMount[] = [];
  for (const element of Array.isArray(value) ? (value as unknown[]) : []) {
    const mount = recordOf(element);
    if (typeof mount?.Destination !== 'string') {
      continue;
    }
    if (mount.Type === 'volume' && typeof mount.Name === 'string') {
      shown.push({
        type: 'volume',
        name: mount.Name,
        destination: mount.Destination,
      });
    } else if (mount.Type === 'bind' && typeof mount.Source === 'string') {
      shown.push({
        type: 'bind',
        source: mount.Source,
        destination: mount.Destination,
      });
    }
  }
  return shown;
}

/** The container of `docker inspect`'s one-element array, or none when the output isn't that. */
export function shownContainerOf(stdout: string): ShownContainer | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  const inspected = Array.isArray(parsed) ? recordOf(parsed[0]) : undefined;
  const config = recordOf(inspected?.Config);
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 1 ||
    typeof inspected?.Id !== 'string' ||
    typeof inspected.Name !== 'string' ||
    typeof config?.Image !== 'string'
  ) {
    return undefined;
  }
  return {
    id: inspected.Id,
    name: inspected.Name,
    image: config.Image,
    labels: labelsOf(config.Labels),
    mounts: mountsOf(inspected.Mounts),
  };
}

/** The section's title: the folder's name, else the cloned repository's name without `.git`, else the image reference. */
function titleOf(shown: ShownContainer): string {
  const folder = devContainerFolderOf(shown.labels);
  if (folder === undefined) {
    return shown.image;
  }
  const name = folderNameOf(folder);
  return localFolderOf(shown.labels) === undefined
    ? name.replace(/\.git$/, '')
    : name;
}

/** The text of string `stringId`, translated. */
function textOf(
  stringId: keyof typeof DETAILS_TEMPLATES,
  translate: Translate,
): string {
  return filled(translate, DETAILS_TEMPLATES[stringId], []);
}

/** A row with no `viewItem` and no children. */
function leaf(rowId: string, label: string, description: string): DetailsRow {
  return {id: rowId, label, description, viewItem: undefined, children: []};
}

/** A row with the given children and no `viewItem` or description. */
function branch(
  rowId: string,
  label: string,
  children: readonly DetailsRow[],
): DetailsRow {
  return {id: rowId, label, description: '', viewItem: undefined, children};
}

/** What decides whether the engine's Docker commands are run by a Windows-side Docker CLI. */
export interface HintSituation {
  platform: string;
  /** The `dev.containers.executeInWSL` setting. */
  executeInWSL: boolean;
  /** The window's remote name; none in a local window. */
  remoteName: string | undefined;
}

/** Whether the I/O performance hint applies: the engine runs from a Windows host's own Docker CLI, not inside WSL. */
export function mountPerformanceHintApplies(situation: HintSituation): boolean {
  return (
    situation.platform === 'win32' &&
    !situation.executeInWSL &&
    situation.remoteName !== 'wsl'
  );
}

/** The row under a bind mount that says bridging the host's and the container's systems costs I/O performance. */
function performanceRow(rowId: string, translate: Translate): DetailsRow {
  const label = textOf('S199', translate);
  const description = textOf('S425', translate);
  return {
    ...leaf(`${rowId}/performance`, label, description),
    viewItem: 'mountPerformance',
    tooltip: `${label} ${description}`,
  };
}

/** The row of one mount, `position` being its place among the mounts of its kind. */
function mountRow(
  mount: ShownMount,
  position: number,
  translate: Translate,
  hint: boolean,
): DetailsRow {
  const rowId = `mounts/${mount.type}-${String(position)}`;
  const destination = leaf(
    `${rowId}/destination`,
    textOf('S109', translate),
    mount.destination,
  );
  return mount.type === 'volume'
    ? branch(rowId, textOf('S396', translate), [
        {
          ...leaf(`${rowId}/volume`, textOf('S393', translate), mount.name),
          viewItem: 'volume',
        },
        destination,
      ])
    : branch(rowId, textOf('S045', translate), [
        leaf(`${rowId}/source`, textOf('S330', translate), mount.source),
        destination,
        ...(hint ? [performanceRow(rowId, translate)] : []),
      ]);
}

/** The tree of `shown`: its title and the sections that have rows. */
export function detailsTreeOf(
  shown: ShownContainer,
  translate: Translate,
  mountPerformanceHint: boolean,
): DetailsTree {
  const configuration = configFileOf(shown.labels);
  const workspace = localFolderOf(shown.labels);
  const attributes = branch('attributes', textOf('S043', translate), [
    ...(workspace === undefined
      ? []
      : [
          leaf(
            'attributes/workspace',
            textOf('workspaceOrigin', translate),
            workspace,
          ),
        ]),
    leaf('attributes/name', textOf('S229', translate), shown.name),
    {
      ...leaf('attributes/image', textOf('S202', translate), shown.image),
      viewItem: 'image',
    },
    ...(configuration === undefined
      ? []
      : [
          {
            ...leaf(
              'attributes/configuration',
              textOf('S080', translate),
              configuration,
            ),
            viewItem: 'devContainer',
          },
        ]),
  ]);
  const mountRows = ['volume', 'bind'].flatMap(type =>
    shown.mounts
      .filter(mount => mount.type === type)
      .map((mount, position) =>
        mountRow(mount, position, translate, mountPerformanceHint),
      ),
  );
  return {
    title: titleOf(shown),
    sections: [
      attributes,
      ...(mountRows.length === 0
        ? []
        : [branch('mounts', textOf('S228', translate), mountRows)]),
    ],
  };
}
