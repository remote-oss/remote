/**
 * @fileoverview The Dev Containers view as a pure tree: the engine's containers, the window's facts and the
 * time go in, and the groups, rows, labels, descriptions, tooltips, icons, `viewItem` tokens, stable ids and the
 * welcome key come out. No editor, no engine and no file is touched here.
 */

import {devContainerFolderOf, isDevContainer} from '../lifecycle/labels.ts';
import {filled} from '../surfaces/filled.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import type {ListedContainer} from './listed-containers.ts';
import {elapsedPhraseOf} from './relative-time.ts';

/** The English template of each text of the tree, by its string id; the first is the view's name. */
const EXPLORER_TEMPLATES = {
  viewName: 'Dev Containers',
  S267: 'Other Containers',
  S429: '{0} ago',
} as const;

/** The icon of a row, by its name in the icon table. */
export type RowIcon = 'vmActive' | 'vmRunning' | 'vm' | 'vmOutline';

/** One row; in 0.4 every row is a container with no children. */
export interface TargetRow {
  id: string;
  label: string;
  description: string;
  tooltip: string;
  icon: RowIcon;
  viewItem: string;
  children: readonly TargetRow[];
}

/** A group header and its rows. */
export interface TargetGroup {
  id: 'devContainers' | 'otherContainers';
  label: string;
  rows: readonly TargetRow[];
}

/** The welcome text the view shows in place of, or beside, its groups. */
export type WelcomeKey =
  | 'needsDockerStartOrInstall'
  | 'noContainersWithFolder'
  | 'noContainersWithoutFolder';

/** The whole tree. */
export interface TargetsTree {
  welcome: WelcomeKey | undefined;
  groups: readonly TargetGroup[];
}

/** What the tree is made from. */
export interface TargetsInput {
  /** The engine's containers, or `unreachable` when it couldn't be asked. */
  containers: readonly ListedContainer[] | 'unreachable';
  window: {
    folderOpen: boolean;
    /** The connection the window holds; none in a window that isn't a dev container's. */
    connection:
      | {containerId: string; hostPath: string; remoteWorkspaceFolder: string}
      | undefined;
  };
  /** The ids of the dev containers whose configuration exists on the host. */
  withConfiguration: ReadonlySet<string>;
  /** The time the tree is built, in epoch milliseconds. */
  now: number;
  translate: Translate;
}

/**
 * How long a container that never exited has run before its tooltip gains a clause. Readings put the threshold between
 * 7 h 25 min (still bare) and 29 h ("1 day"); a day is the point inside that range that reads "1 day".
 */
const LONG_RUN_MILLISECONDS = 24 * 60 * 60 * 1000;

/** The states whose Docker name is a `viewItem` token. */
const STATE_TOKENS: readonly string[] = [
  'running',
  'exited',
  'created',
  'paused',
  'restarting',
];

/** The states in which Docker lets the row start, stop and remove its container, one list for each action. */
const START_STATES: readonly string[] = ['exited', 'created', 'restarting'];
const STOP_STATES: readonly string[] = ['running', 'paused'];
const REMOVE_STATES: readonly string[] = ['running', 'exited'];

/**
 * BR-9's order for an English display language: the collator's default strength, which puts punctuation first, a
 * hyphen before a letter, lower case before upper case, and an accented letter after the plain ones, and compares
 * digits as characters (AC-48).
 */
const LABEL_COLLATOR = new Intl.Collator('en');

/** The last segment of a folder label's value with its trailing slashes dropped (BR-3 on a Linux UI); the value when nothing is left. */
export function folderNameOf(value: string): string {
  const trimmed = value.replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || value;
}

/** The icon of a container's state (§3.3). */
function iconOf(state: string): RowIcon {
  if (state === 'running') {
    return 'vmRunning';
  }
  return state === 'paused' || state === 'restarting' ? 'vmOutline' : 'vm';
}

/** The state as the tooltip words it. */
function stateWordOf(state: string): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

/** The tooltip's relative-time clause or none. */
function clauseOf(
  container: ListedContainer,
  now: number,
  translate: Translate,
): string | undefined {
  const {state, startedAt, finishedAt} = container;
  function phrase(since: number): string {
    return elapsedPhraseOf(now - since, translate);
  }
  function agoPhrase(since: number): string {
    return filled(translate, EXPLORER_TEMPLATES.S429, [phrase(since)]);
  }
  if (state === 'exited') {
    return finishedAt === undefined ? undefined : agoPhrase(finishedAt);
  }
  if (state === 'restarting') {
    const since = finishedAt ?? startedAt;
    return since === undefined ? undefined : phrase(since);
  }
  const exitedBefore = finishedAt !== undefined;
  if (startedAt === undefined) {
    return undefined;
  }
  if (state === 'running') {
    return exitedBefore || now - startedAt >= LONG_RUN_MILLISECONDS
      ? phrase(startedAt)
      : undefined;
  }
  return state === 'paused' && exitedBefore ? agoPhrase(startedAt) : undefined;
}

/**
 * The tokens of the actions a row offers; the manifest's menus only match them. A window's own row offers none that
 * would end its connection or open it again.
 */
function actionTokensOf(
  state: string,
  own: boolean,
  openable: boolean,
): string[] {
  return [
    ...(openable && !own ? ['openFolder'] : []),
    ...(!own && START_STATES.includes(state) ? ['start'] : []),
    ...(!own && STOP_STATES.includes(state) ? ['stop'] : []),
    ...(!own && REMOVE_STATES.includes(state) ? ['remove'] : []),
    'details',
    'inspect',
    'log',
  ];
}

/** The row of one container. */
function rowOf(container: ListedContainer, input: TargetsInput): TargetRow {
  const {labels, id: containerId, name, image, state} = container;
  const devContainer = isDevContainer(labels);
  const own = input.window.connection?.containerId === containerId;
  const folder = devContainerFolderOf(labels);
  const label = folder === undefined ? image : folderNameOf(folder);
  const status = own ? 'Connected' : stateWordOf(state);
  const clause = own
    ? undefined
    : clauseOf(container, input.now, input.translate);
  const configured = devContainer && input.withConfiguration.has(containerId);
  const tokens = [
    'container',
    devContainer ? 'dev' : 'other',
    ...(STATE_TOKENS.includes(state) ? [state] : []),
    ...(own ? ['own'] : []),
    ...(own && devContainer && input.window.folderOpen ? ['activeFolder'] : []),
    ...(configured ? ['configuration'] : []),
    ...actionTokensOf(state, own, configured),
  ];
  return {
    id: containerId,
    label,
    description: name,
    tooltip: `${label} (${name}) ${status}${clause === undefined ? '' : ` ${clause}`}`,
    icon: own ? 'vmActive' : iconOf(state),
    viewItem: tokens.join(' '),
    children: [],
  };
}

/** The rows of `containers` in order: by label, then the most recently created first. */
function sortedRows(
  containers: readonly ListedContainer[],
  input: TargetsInput,
): TargetRow[] {
  return containers
    .map(container => ({container, target: rowOf(container, input)}))
    .sort(
      (left, right) =>
        LABEL_COLLATOR.compare(left.target.label, right.target.label) ||
        right.container.createdAt - left.container.createdAt ||
        left.container.id.localeCompare(right.container.id),
    )
    .map(entry => entry.target);
}

/** The tree: the groups, each only while it has a row, and the welcome key when there is nothing to list. */
export function targetsTreeOf(input: TargetsInput): TargetsTree {
  const {containers, translate} = input;
  if (containers === 'unreachable') {
    return {welcome: 'needsDockerStartOrInstall', groups: []};
  }
  if (containers.length === 0) {
    return {
      welcome: input.window.folderOpen
        ? 'noContainersWithFolder'
        : 'noContainersWithoutFolder',
      groups: [],
    };
  }
  const groups: TargetGroup[] = [
    {
      id: 'devContainers',
      label: translate(EXPLORER_TEMPLATES.viewName),
      rows: sortedRows(
        containers.filter(container => isDevContainer(container.labels)),
        input,
      ),
    },
    {
      id: 'otherContainers',
      label: translate(EXPLORER_TEMPLATES.S267),
      rows: sortedRows(
        containers.filter(container => !isDevContainer(container.labels)),
        input,
      ),
    },
  ];
  return {
    welcome: undefined,
    groups: groups.filter(group => group.rows.length > 0),
  };
}
