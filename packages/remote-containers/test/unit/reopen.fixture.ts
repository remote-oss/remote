/**
 * @fileoverview The fakes of the open commands' tests: the ports of Reopen in Container over a setup a row steers, and
 * what they recorded.
 */

import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {CliFailure, ConfigurationResult} from '../../src/cli/cli-lines.ts';
import type {PickerAnswer} from '../../src/config/choose-configuration.ts';
import type {ReopenPorts} from '../../src/open/reopen-ports.ts';
import type {TrustOutcome} from '../../src/trust/trust-gate.ts';

/** The folder the rows open. */
export const FOLDER = '/w/p';
/** Its configuration file. */
export const CONFIG = '/w/p/.devcontainer/devcontainer.json';
/** The text of the progress that shows while the checks take long. */
export const START =
  '[Connecting to Dev Container (show log)](command:remote-containers.revealLogTerminal)';
/** What the CLI reads of that configuration. */
export const CONFIGURATION: ConfigurationResult = {
  kind: 'configuration',
  configuration: {},
  workspaceFolder: '/workspaces/p',
  workspaceMount: undefined,
  mergedConfiguration: undefined,
};

/** The pieces a row steers, and what the fakes recorded. */
export interface Setup {
  calls: string[];
  commands: Array<{command: string; parameters: unknown[]}>;
  lines: string[];
  read: ConfigurationResult | CliFailure;
  check: 'proceed' | 'stopped';
  context: string | undefined;
  existing: string[];
  /** What the picker answers, and what the notices and dialogs showed. */
  pick: PickerAnswer;
  shown: string[];
  contents: Record<string, string>;
  remoteName: string | undefined;
  folders: Array<{scheme: string; fsPath: string}>;
  trust: TrustOutcome;
  /** The command titles the trust check was asked for. */
  titles: string[];
  /** What the intent store was asked to write, and whether it refuses. */
  updates: unknown[];
  intentFailure: unknown;
  /** What the activation's probe found missing, and what the probe after it finds. */
  missing: string[];
  missingAfter: string[];
  waitOnTrust: Promise<void>;
  rejects: string | undefined;
  dockerPath: unknown;
  /** What the worktree setting's user value is. */
  mountGitWorktreeCommonDir: unknown;
  waitOnCheck: Promise<void>;
  targets: unknown[];
  /** The order of the progress and the open, as far as the rows on them look. */
  order: string[];
  /** What the progress asked the clock for. */
  timers: Array<{milliseconds: number; callback: () => void}>;
  /** How many times the window told the shutdown helper that it leaves its container. */
  left: number;
}

/** A setup of a trusted local window on the folder, with its configuration and a passing engine. */
export function setup(): Setup {
  return {
    calls: [],
    commands: [],
    lines: [],
    read: CONFIGURATION,
    check: 'proceed',
    context: undefined,
    existing: [CONFIG],
    pick: {kind: 'picked', index: 0},
    shown: [],
    contents: {},
    remoteName: undefined,
    folders: [{scheme: 'file', fsPath: FOLDER}],
    trust: 'trusted',
    titles: [],
    updates: [],
    intentFailure: undefined,
    missing: [],
    missingAfter: [],
    waitOnTrust: Promise.resolve(),
    rejects: undefined,
    dockerPath: 'docker',
    mountGitWorktreeCommonDir: undefined,
    waitOnCheck: Promise.resolve(),
    targets: [],
    order: [],
    timers: [],
    left: 0,
  };
}

/** The ports over a setup; each call that reaches a port is recorded in `calls`. */
export function portsOf(state: Setup): {ports: ReopenPorts; sink: MemorySink} {
  const sink = new MemorySink();
  const ports: ReopenPorts = {
    gate: {
      missing: state.missing,
      setupAgain: () => {
        state.calls.push('setupAgain');
        return Promise.resolve({decision: {missing: state.missingAfter}});
      },
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
    },
    window: {
      remoteName: () => state.remoteName,
      folders: () => state.folders,
      serializedFile: file => ({
        $mid: 1,
        fsPath: file,
        external: `file://${file}`,
        path: file,
        scheme: 'file',
      }),
    },
    ensureTrusted: async title => {
      state.titles.push(title);
      state.calls.push('ensureTrusted');
      await state.waitOnTrust;
      return state.trust;
    },
    intents: {
      get: () => undefined,
      update: (key, value) => {
        state.calls.push('storeIntent');
        state.order.push('store');
        if (state.intentFailure !== undefined) {
          // The row on a rejection that is not an error needs exactly that.
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          return Promise.reject(state.intentFailure);
        }
        state.updates.push([key, value]);
        return Promise.resolve();
      },
    },
    now: () => 1000,
    config: {
      files: {
        list: folder => {
          const entries = new Map<string, 'file' | 'folder'>();
          for (const file of state.existing) {
            const relative = file.slice(FOLDER.length + 1).split('/');
            const parent = [FOLDER, ...relative.slice(0, -1)].join('/');
            if (parent === folder) {
              entries.set(relative.at(-1) ?? '', 'file');
            }
            for (let depth = 1; depth < relative.length; depth += 1) {
              const above = [FOLDER, ...relative.slice(0, depth - 1)].join('/');
              if (above === folder) {
                entries.set(relative[depth - 1] ?? '', 'folder');
              }
            }
          }
          return Promise.resolve(
            [...entries].map(([name, kind]) => ({name, kind})),
          );
        },
        read: file =>
          Promise.resolve(Buffer.from(state.contents[file] ?? '{"image":"i"}')),
        exists: () => Promise.resolve(true),
      },
      surfaces: {
        pick: rows => {
          state.shown.push(`pick ${String(rows.length)}`);
          return Promise.resolve(state.pick);
        },
        dialogs: {
          showError: (message, detail) => {
            state.shown.push(`error ${message}${detail}`);
            return Promise.resolve(undefined);
          },
          revealLog: () => undefined,
        },
        showWarning: () => Promise.resolve(undefined),
        openPreview: () => Promise.resolve(),
        showInformation: message => {
          state.shown.push(`info ${message}`);
        },
      },
      compare: (left, right) => left.localeCompare(right, 'en'),
      translate: template => template,
    },
    settings: {
      dockerPath: () => state.dockerPath,
      mountGitWorktreeCommonDir: () => state.mountGitWorktreeCommonDir,
    },
    engine: {
      firstCheck: async base => {
        state.calls.push(`firstCheck ${String(base)}`);
        await state.waitOnCheck;
        return state.check;
      },
      currentContext: () => {
        state.calls.push('currentContext');
        return Promise.resolve(state.context);
      },
    },
    dialogs: {
      showError: () => Promise.resolve(undefined),
      openExternal: () => Promise.resolve(undefined),
      revealLog: () => undefined,
    },
    progress: {
      showProgress: (title, until) => {
        state.order.push(`progress shown ${title}`);
        void until.then(() => {
          state.order.push('progress closed');
        });
      },
      setTimer: (milliseconds, callback) => {
        state.timers.push({milliseconds, callback});
        return () => undefined;
      },
      translate: template => template,
    },
    bridge: {
      readConfiguration: target => {
        state.targets.push(target);
        state.calls.push(`readConfiguration ${target.workspaceFolder}`);
        return Promise.resolve(state.read);
      },
    },
    shutdown: {
      leave: () => {
        state.left += 1;
        state.order.push('leave');
        return Promise.resolve();
      },
    },
    opener: {
      executeCommand: (command, ...parameters) => {
        state.commands.push({command, parameters});
        queueMicrotask(() => {
          state.order.push('open');
        });
        return state.rejects === undefined
          ? Promise.resolve(undefined)
          : Promise.reject(new Error(state.rejects));
      },
      addressOf: parts => parts,
    },
    logger: createLogger(sink, {minimumLevel: () => 'info'}),
  };
  return {ports, sink};
}

/** The messages a sink saw, with their levels. */
export function linesOf(sink: MemorySink): string[] {
  return sink.lines.map(line => `${line.level}: ${line.message}`);
}
