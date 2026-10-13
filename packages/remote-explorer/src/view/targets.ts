/**
 * @fileoverview The targets of the Remotes view: the "SSH" group and a row for each configured host, built from the
 * two questions put to the SSH companion. The newest build decides what is shown, whatever order the answers come in.
 */

import type {CompanionDetector, Registration} from 'lib-companion';
import {SSH_COMPANION_ID} from 'lib-companion';
import {
  type ActivePull,
  CONNECTED_MARKER,
  markedRowIds,
} from '../model/connected-marker.ts';
import {buildSshRows, type HostRow} from '../model/ssh-group.ts';
import type {CompanionCalls} from './companion-calls.ts';

/** The "SSH" group node. */
interface GroupNode {
  readonly kind: 'sshGroup';
}

/** A configured host and whether the window is connected to it. */
export interface HostNode {
  readonly kind: 'sshHost';
  readonly hostRow: HostRow;
  readonly connected: boolean;
}

/** A node of the Remotes view. */
export type TargetNode = GroupNode | HostNode;

/** What the tree shows for a node. */
export interface TargetItem {
  id: string;
  label: string;
  tooltip: string;
  description?: string;
  iconId?: string;
  contextValue: string;
  /** True: expanded; absent: not collapsible. */
  expanded?: true;
}

/** What the targets are built from. */
export interface TargetsOptions {
  calls: CompanionCalls;
  detector: Pick<CompanionDetector, 'isPresent' | 'onPresenceChanged'>;
  /** Subscribes to changes of the configuration file setting. */
  configFileChanges(listener: () => void): Registration;
  /** The description of the connected row, in the user's language. */
  connectedText: string;
}

/** The nodes of the Remotes view and what rebuilds them. */
export interface Targets extends Registration {
  /** The roots for `undefined`; a group's hosts once the latest build has settled; `[]` for a host. */
  children(node: TargetNode | undefined): Promise<readonly TargetNode[]>;
  itemOf(node: TargetNode): TargetItem;
  /** The value itself when it is a host node of the current list; otherwise undefined. */
  hostOf(value: unknown): HostNode | undefined;
  /** A full build: the pull, then the host list. Never rejects. */
  rebuild(): Promise<void>;
  /** The host list alone. Never rejects. */
  rebuildHosts(): Promise<void>;
  onDidChange(listener: () => void): Registration;
}

/** What the view's commands use once the view is shown. */
export interface ViewSession {
  readonly targets: Targets;
  readonly calls: CompanionCalls;
}

const GROUP_ITEM: TargetItem = {
  id: 'ssh-group',
  label: 'SSH',
  tooltip: 'SSH',
  contextValue: 'remote-explorer.sshGroup',
  expanded: true,
};

const HOST_CONTEXT = 'remote-explorer.sshRemoteTarget';

/** The first of equal strings, in order. */
function distinct(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** The targets of the view over the companion's answers. */
export function createTargets(options: TargetsOptions): Targets {
  const group: GroupNode = {kind: 'sshGroup'};
  const listeners = new Set<() => void>();
  let pull: ActivePull | undefined;
  let aliases: readonly string[] = [];
  let hostNodes: readonly HostNode[] = [];
  let buildNumber = 0;
  let fullBuildNumber = 0;
  let newest: Promise<void> | undefined;
  let disposed = false;

  function present(): boolean {
    return options.detector.isPresent(SSH_COMPANION_ID) === 'present';
  }

  /** New host nodes from the stored aliases and pull. */
  function makeNodes(): void {
    const rows = buildSshRows(distinct(aliases), new Map(), undefined);
    const marked = new Set(markedRowIds(rows, pull));
    hostNodes = rows.map(hostRow => ({
      kind: 'sshHost',
      hostRow,
      connected: marked.has(hostRow.rowId),
    }));
  }

  function tell(): void {
    for (const listener of [...listeners]) {
      listener();
    }
  }

  /** Runs a build whose numbers were taken already, and stores what it supersedes when it settles. */
  async function settle(
    build: number,
    fullBuild: number | undefined,
    pullCall: ReturnType<CompanionCalls['activeRemote']> | undefined,
    hostsCall: ReturnType<CompanionCalls['hostnames']>,
  ): Promise<void> {
    const [pullOutcome, hostsOutcome] = await Promise.all([
      pullCall,
      hostsCall,
    ]);
    let stored = false;
    if (build === buildNumber) {
      aliases =
        hostsOutcome.status === 'answered' ? hostsOutcome.value.hostnames : [];
      stored = true;
    }
    if (fullBuild !== undefined && fullBuild === fullBuildNumber) {
      pull =
        pullOutcome?.status === 'answered'
          ? {
              connected: pullOutcome.value.connected,
              ...(pullOutcome.value.hostKey === undefined
                ? {}
                : {hostKey: pullOutcome.value.hostKey}),
            }
          : undefined;
      stored = true;
    }
    if (stored && !disposed) {
      makeNodes();
      tell();
    }
  }

  /** Takes the numbers of a build and starts it; the newest build is the one `children` waits for. */
  function start(full: boolean): Promise<void> {
    if (!present()) {
      return Promise.resolve();
    }
    buildNumber += 1;
    const build = buildNumber;
    let fullBuild: number | undefined;
    let pullCall: ReturnType<CompanionCalls['activeRemote']> | undefined;
    if (full) {
      fullBuildNumber += 1;
      fullBuild = fullBuildNumber;
      pullCall = options.calls.activeRemote();
    }
    const running = settle(
      build,
      fullBuild,
      pullCall,
      options.calls.hostnames(),
    );
    newest = running;
    void running.then(() => {
      if (newest === running) {
        newest = undefined;
      }
    });
    return running;
  }

  const presence = options.detector.onPresenceChanged(() => {
    if (!disposed) {
      void start(true);
    }
  });
  const configuration = options.configFileChanges(() => {
    if (!disposed) {
      void start(false);
    }
  });

  return {
    children: async node => {
      if (node === undefined) {
        return present() ? [group] : [];
      }
      if (node.kind === 'sshHost') {
        return [];
      }
      await newest;
      return hostNodes;
    },
    itemOf: node => {
      if (node.kind === 'sshGroup') {
        return {...GROUP_ITEM};
      }
      return {
        id: node.hostRow.rowId,
        label: node.hostRow.alias,
        tooltip: node.hostRow.alias,
        ...(node.connected ? {description: options.connectedText} : {}),
        iconId: node.connected ? CONNECTED_MARKER.icon : 'vm',
        contextValue: HOST_CONTEXT,
      };
    },
    hostOf: value => hostNodes.find(node => node === value),
    rebuild: () => start(true),
    rebuildHosts: () => start(false),
    onDidChange: listener => {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    dispose: () => {
      disposed = true;
      presence.dispose();
      configuration.dispose();
      listeners.clear();
    },
  };
}
