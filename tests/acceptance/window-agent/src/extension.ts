import {appendFileSync, existsSync, mkdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import {MEMORY_SCHEME, MemoryFileSystem} from './memory-file-system.ts';
import {
  claimWindowName,
  recordWindowName,
  windowNameOf,
} from './window-name.ts';

/** How often the agent looks for a new command, in milliseconds. */
const POLL_MILLISECONDS = 200;

/** The variable the run passes to every launch: the folder this launch's windows write their pid files to. */
const WINDOWS_VARIABLE = 'REMOTE_OSS_ACCEPTANCE_WINDOWS';

/** A command a test wrote for this window. */
interface AgentCommand {
  id: string;
  command: string;
  parameters?: unknown[];
  /** Whether the command starts without waiting for the ones before it to end, and the next ones without waiting for it. */
  concurrent?: true;
}

/** The name of this window's current start: claimed or kept at activation, reported at deactivation. */
let windowName: string | undefined;

/**
 * The window's deactivation is reported once, by the first of the extension's deactivate, a SIGTERM or the process's
 * exit that reaches the report: however the extension host goes, the harness sees one deactivation.
 */
let deactivatedReported = false;

/**
 * This launch's agent folder, which the launch's variable points its pid files to. Without the variable the
 * harness is off and the agent does nothing.
 */
function agentFolderOf(): string | undefined {
  const pids = process.env[WINDOWS_VARIABLE];
  return pids === undefined || pids === '' ? undefined : path.dirname(pids);
}

/**
 * The name of this window, claimed at activation and written to the launch's pid file for this process: a window
 * with a folder keeps its folder name and claims nothing, and a window without one claims the first free name.
 * The pid file is the source the window's own adapters read, and it is rewritten at every activation, so a reused
 * process id never carries the name of the window that ran in it before.
 */
function activationName(agentFolder: string): string {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const first = folder?.scheme === MEMORY_SCHEME ? MEMORY_SCHEME : folder?.path;
  const name =
    first === undefined
      ? claimWindowName(path.join(agentFolder, 'claims'))
      : windowNameOf(first);
  recordWindowName(path.join(agentFolder, 'pids'), process.pid, name);
  return name;
}

/**
 * The authority the window's own extension wrote beside the pid file, so that a window without a folder can still
 * report where it is; none until the extension resolves the window's authority.
 */
function authorityOf(agentFolder: string, processId: number): string | null {
  const file = path.join(agentFolder, 'pids', `${String(processId)}.authority`);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** A file of this window's agent in the launch's folder: its `events` or its `commands`. */
function agentFile(
  agentFolder: string,
  name: string,
  kind: 'events' | 'commands',
): string {
  mkdirSync(agentFolder, {recursive: true});
  return path.join(agentFolder, `${name}.${kind}.jsonl`);
}

/** Appends one event as a single write, so that two windows never split a line. */
function report(
  agentFolder: string,
  name: string,
  event: Record<string, unknown>,
): void {
  appendFileSync(
    agentFile(agentFolder, name, 'events'),
    `${JSON.stringify({...event, time: Date.now()})}\n`,
  );
}

/** The ids of the commands this window's agent, in any of its starts, has accepted. */
function acceptedIds(agentFolder: string, name: string): Set<string> {
  const file = agentFile(agentFolder, name, 'events');
  if (!existsSync(file)) {
    return new Set();
  }
  return new Set(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter(line => line !== '')
      .map(line => JSON.parse(line) as {event: string; id?: string})
      .filter(each => each.event === 'accepted')
      .map(each => each.id ?? ''),
  );
}

/** The commands of this window's file that no start of its agent has accepted yet: a reload does not lose or repeat one. */
function pendingCommands(agentFolder: string, name: string): AgentCommand[] {
  const file = agentFile(agentFolder, name, 'commands');
  if (!existsSync(file)) {
    return [];
  }
  const accepted = acceptedIds(agentFolder, name);
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line !== '')
    .map(line => JSON.parse(line) as AgentCommand)
    .filter(each => !accepted.has(each.id));
}

/** Runs one command: `accepted` first, since a reload or a close may never write `done`. */
async function execute(
  agentFolder: string,
  name: string,
  each: AgentCommand,
): Promise<void> {
  report(agentFolder, name, {event: 'accepted', id: each.id});
  try {
    await vscode.commands.executeCommand(
      each.command,
      ...(each.parameters ?? []),
    );
    report(agentFolder, name, {event: 'done', id: each.id});
  } catch (error) {
    report(agentFolder, name, {
      event: 'failed',
      id: each.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The name of the output channel an editor of the window shows, or none: an output channel's document is `output:`. */
function visibleOutputChannelOf(
  documents: readonly vscode.Uri[],
): string | null {
  const shown = documents.find(each => each.scheme === 'output');
  return shown === undefined ? null : shown.path.replace(/^.*-#\d+-/, '');
}

/** The active tab of the window when it holds a text file: its URI and whether it is a preview; null for any other tab. */
function activeTabOf(
  current: vscode.Tab | undefined,
): {uri: string; preview: boolean} | null {
  if (
    current === undefined ||
    !(current.input instanceof vscode.TabInputText)
  ) {
    return null;
  }
  return {uri: current.input.uri.toString(), preview: current.isPreview};
}

/** The editor commands that copy the active terminal's whole buffer to the clipboard, in order. */
const COPY_STEPS = [
  'workbench.action.terminal.focus',
  'workbench.action.terminal.selectAll',
  'workbench.action.terminal.copySelection',
  'workbench.action.terminal.clearSelection',
];

/** How long a copy step may take before the read gives up and names it. */
const COPY_STEP_MILLISECONDS = 10_000;

/** Whether `pending` settled within `milliseconds`; one that did not is left to settle on its own. */
async function settledWithin(
  pending: PromiseLike<unknown>,
  milliseconds: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<false>(resolve => {
    timer = setTimeout(() => {
      resolve(false);
    }, milliseconds);
  });
  try {
    return await Promise.race([
      Promise.resolve(pending).then(
        () => true,
        () => true,
      ),
      expired,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Starts the agent: reports the window's activation, registers its own commands and polls for the test's commands. */
export function activate(context: vscode.ExtensionContext): void {
  const agentFolder = agentFolderOf();
  if (agentFolder === undefined) {
    return;
  }
  const memory = new MemoryFileSystem();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(MEMORY_SCHEME, memory, {
      isCaseSensitive: true,
    }),
  );
  const name = activationName(agentFolder);
  windowName = name;
  report(agentFolder, name, {event: 'activated'});
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'acceptance.agent.openWindow',
      (uri: string) => {
        // The open is not awaited: the command ends in this window, and the new window's own agent serves it.
        const address = vscode.Uri.parse(uri);
        if (
          address.scheme !== MEMORY_SCHEME &&
          (address.path === '' || address.path === '/')
        ) {
          // An authority with no folder opens an empty window on it, the way the connect commands do.
          void vscode.commands.executeCommand('vscode.newWindow', {
            remoteAuthority:
              address.authority === '' ? null : address.authority,
            reuseWindow: false,
          });
          return;
        }
        void vscode.commands.executeCommand('vscode.openFolder', address, {
          forceNewWindow: true,
        });
      },
    ),
    vscode.commands.registerCommand(
      'acceptance.agent.sleep',
      (milliseconds: number) =>
        new Promise<void>(resolve => {
          setTimeout(resolve, milliseconds);
        }),
    ),
    vscode.commands.registerCommand('acceptance.agent.state', () => {
      report(agentFolder, name, {
        event: 'state',
        remoteName: vscode.env.remoteName ?? null,
        remoteAuthority: authorityOf(agentFolder, process.pid),
        folders: (vscode.workspace.workspaceFolders ?? []).map(each =>
          each.uri.toString(),
        ),
        workspaceFile: vscode.workspace.workspaceFile?.toString() ?? null,
        visibleOutputChannel: visibleOutputChannelOf(
          vscode.window.visibleTextEditors.map(editor => editor.document.uri),
        ),
        trusted: vscode.workspace.isTrusted,
        remoteSshActive:
          vscode.extensions.getExtension('remote-oss.remote-ssh')?.isActive ??
          false,
        terminals: vscode.window.terminals.map(terminal => terminal.name),
        activeEditor:
          vscode.window.activeTextEditor?.document.uri.fsPath ?? null,
        activeTab: activeTabOf(
          vscode.window.tabGroups.activeTabGroup.activeTab,
        ),
        dirtyDocuments: vscode.workspace.textDocuments
          .filter(document => document.isDirty)
          .map(document => document.uri.toString()),
      });
    }),
    vscode.commands.registerCommand(
      'acceptance.agent.openUntitled',
      async (content: string) => {
        await vscode.window.showTextDocument(
          await vscode.workspace.openTextDocument({content}),
        );
      },
    ),
    vscode.commands.registerCommand(
      'acceptance.agent.setting',
      (settingId: string) => {
        const configuration = vscode.workspace.getConfiguration();
        report(agentFolder, name, {
          event: 'setting',
          settingId,
          value: configuration.get(settingId) ?? null,
          defaultValue: configuration.inspect(settingId)?.defaultValue ?? null,
          inUserScope:
            configuration.inspect(settingId)?.globalValue !== undefined,
        });
      },
    ),
    vscode.commands.registerCommand(
      'acceptance.agent.commands',
      async (prefix: string) => {
        report(agentFolder, name, {
          event: 'commands',
          prefix,
          commandIds: (await vscode.commands.getCommands(true))
            .filter(commandId => commandId.startsWith(prefix))
            .sort(),
        });
      },
    ),
    vscode.commands.registerCommand(
      'acceptance.agent.recentlyOpened',
      async () => {
        const recent = await vscode.commands.executeCommand<{
          workspaces: Array<{
            folderUri?: vscode.Uri;
            workspace?: {configPath: vscode.Uri};
            label?: string;
            remoteAuthority?: string;
          }>;
        }>('_workbench.getRecentlyOpened');
        report(agentFolder, name, {
          event: 'recentlyOpened',
          recent: recent.workspaces.map(entry => ({
            uri:
              (entry.folderUri ?? entry.workspace?.configPath)?.toString() ??
              '',
            label: entry.label ?? null,
            remoteAuthority: entry.remoteAuthority ?? null,
          })),
        });
      },
    ),
    vscode.commands.registerCommand(
      'acceptance.agent.extensionPresent',
      (extensionId: string) => {
        const extension = vscode.extensions.getExtension(extensionId);
        report(agentFolder, name, {
          event: 'extension',
          extensionId,
          present: extension !== undefined,
          extensionActive: extension?.isActive === true,
          editorVersion: vscode.version,
        });
      },
    ),
    vscode.commands.registerCommand(
      'acceptance.agent.updateSetting',
      (settingId: string, value: unknown) =>
        vscode.workspace
          .getConfiguration()
          .update(settingId, value, vscode.ConfigurationTarget.Global),
    ),
    vscode.commands.registerCommand(
      'acceptance.agent.removeSetting',
      (settingId: string) =>
        vscode.workspace
          .getConfiguration()
          .update(settingId, undefined, vscode.ConfigurationTarget.Global),
    ),
    vscode.commands.registerCommand(
      'acceptance.agent.forwardPort',
      async (remotePort: number) => {
        // openTunnel is a proposed API the agent's manifest enables; the types of the proposal are not part of this project.
        const workspace = vscode.workspace as unknown as {
          openTunnel(options: {
            remoteAddress: {host: string; port: number};
          }): PromiseLike<{
            localAddress: string | {host: string; port: number};
          }>;
        };
        const tunnel = await workspace.openTunnel({
          remoteAddress: {host: 'localhost', port: remotePort},
        });
        report(agentFolder, name, {
          event: 'forwarded',
          localAddress: tunnel.localAddress,
          remotePort,
        });
      },
    ),
    vscode.commands.registerCommand('acceptance.agent.tunnels', async () => {
      // The tunnels are a proposed API the agent's manifest enables; the types of the proposal are not part of this project.
      const workspace = vscode.workspace as unknown as {
        tunnels: PromiseLike<
          Array<{
            remoteAddress: {host: string; port: number};
            localAddress: string | {host: string; port: number};
          }>
        >;
      };
      report(agentFolder, name, {
        event: 'tunnels',
        tunnels: (await workspace.tunnels).map(tunnel => ({
          remotePort: tunnel.remoteAddress.port,
          localAddress:
            typeof tunnel.localAddress === 'string'
              ? tunnel.localAddress
              : `${tunnel.localAddress.host}:${String(tunnel.localAddress.port)}`,
        })),
      });
    }),
    vscode.commands.registerCommand(
      'acceptance.agent.writeFile',
      async (writeName: string, text: string) => {
        // A full URI is written as it is, so a window with no folder can write through its remote file system.
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
        const target = writeName.includes('://')
          ? vscode.Uri.parse(writeName)
          : folder === undefined
            ? undefined
            : vscode.Uri.joinPath(folder, writeName);
        if (target === undefined) {
          throw new Error('the window has no folder');
        }
        await vscode.workspace.fs.writeFile(
          target,
          new TextEncoder().encode(text),
        );
      },
    ),
    vscode.commands.registerCommand(
      'acceptance.agent.openFile',
      async (relative: string) => {
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (folder === undefined) {
          throw new Error('the window has no folder');
        }
        await vscode.window.showTextDocument(
          await vscode.workspace.openTextDocument(
            vscode.Uri.joinPath(folder, relative),
          ),
        );
      },
    ),
    vscode.commands.registerCommand(
      'acceptance.agent.terminalBuffer',
      async () => {
        const terminals = vscode.window.terminals.map(each => each.name);
        const active = vscode.window.activeTerminal?.name ?? null;
        if (active === null) {
          // Focusing would create a terminal and wait for it, so a window with none answers at once.
          report(agentFolder, name, {
            event: 'terminalBuffer',
            text: '',
            terminals,
            active,
          });
          return;
        }
        for (const step of COPY_STEPS) {
          const finished = await settledWithin(
            vscode.commands.executeCommand(step),
            COPY_STEP_MILLISECONDS,
          );
          if (!finished) {
            report(agentFolder, name, {
              event: 'terminalBuffer',
              text: null,
              terminals,
              active,
              stuck: step,
            });
            return;
          }
        }
        let copied: string | undefined;
        const read = await settledWithin(
          Promise.resolve(vscode.env.clipboard.readText()).then(text => {
            copied = text;
          }),
          COPY_STEP_MILLISECONDS,
        );
        report(agentFolder, name, {
          event: 'terminalBuffer',
          text: read ? (copied ?? '') : null,
          terminals,
          active,
          ...(read ? {} : {stuck: 'clipboard.readText'}),
        });
      },
    ),
    vscode.commands.registerCommand(
      'acceptance.agent.runProcessTask',
      async (command: string, programArguments: string[]) => {
        const task = new vscode.Task(
          {type: 'acceptance'},
          vscode.TaskScope.Workspace,
          'acceptance',
          'acceptance',
          new vscode.ProcessExecution(command, programArguments),
        );
        const execution = await vscode.tasks.executeTask(task);
        const exitCode = await new Promise<number | null>(resolve => {
          const end = vscode.tasks.onDidEndTaskProcess(event => {
            if (event.execution === execution) {
              end.dispose();
              resolve(event.exitCode ?? null);
            }
          });
        });
        report(agentFolder, name, {event: 'taskEnded', exitCode});
      },
    ),
    vscode.commands.registerCommand(
      'acceptance.agent.untitledDocuments',
      () => {
        report(agentFolder, name, {
          event: 'untitledDocuments',
          documents: vscode.workspace.textDocuments
            .filter(document => document.uri.scheme === 'untitled')
            .map(document => ({
              uri: document.uri.toString(),
              language: document.languageId,
              text: document.getText(),
              dirty: document.isDirty,
            })),
        });
      },
    ),
    vscode.commands.registerCommand('acceptance.agent.terminalNames', () => {
      report(agentFolder, name, {
        event: 'terminalNames',
        names: vscode.window.terminals.map(each => each.name),
      });
    }),
    vscode.commands.registerCommand(
      'acceptance.agent.updateWorkspaceFolders',
      (start: number, deleteCount: number, uris: string[]) => {
        const updated = vscode.workspace.updateWorkspaceFolders(
          start,
          deleteCount,
          ...uris.map(each => ({uri: vscode.Uri.parse(each)})),
        );
        if (!updated) {
          throw new Error('the workspace folders were not updated');
        }
      },
    ),
    vscode.commands.registerCommand(
      'acceptance.agent.memoryWrite',
      (file: string, text: string) => {
        memory.writeFile(
          vscode.Uri.from({scheme: MEMORY_SCHEME, path: file}),
          new TextEncoder().encode(text),
        );
      },
    ),
    vscode.commands.registerCommand(
      'acceptance.agent.environment',
      (variableName: string) => {
        report(agentFolder, name, {
          event: 'environment',
          value: process.env[variableName] ?? null,
        });
      },
    ),
    vscode.commands.registerCommand(
      'acceptance.agent.writeActiveEditor',
      async (text: string) => {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) {
          throw new Error('the window has no active text editor');
        }
        const document = editor.document;
        await editor.edit(edit => {
          edit.replace(
            new vscode.Range(
              document.positionAt(0),
              document.positionAt(document.getText().length),
            ),
            text,
          );
        });
        await document.save();
      },
    ),
    vscode.commands.registerCommand('acceptance.agent.statFolder', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (folder === undefined) {
        throw new Error('the window has no folder');
      }
      await vscode.workspace.fs.stat(folder);
    }),
  );
  let busy = false;
  const timer = setInterval(() => {
    if (busy) {
      return;
    }
    busy = true;
    const waiting = pendingCommands(agentFolder, name);
    void (async () => {
      for (const each of waiting) {
        if (each.concurrent === true) {
          // `execute` reports `accepted` before it awaits, so the next poll doesn't start the command again.
          void execute(agentFolder, name, each);
        } else {
          await execute(agentFolder, name, each);
        }
      }
      busy = false;
    })();
  }, POLL_MILLISECONDS);
  context.subscriptions.push({
    dispose: () => {
      clearInterval(timer);
    },
  });
  // The extension host may end without the extension's deactivate: a killed window, a signal, a crash. The
  // harness waits for the deactivation, so the process itself reports it, once, on every end it can reach.
  process.on('SIGTERM', () => {
    reportDeactivated();
    process.exit(0);
  });
  process.on('exit', () => {
    reportDeactivated();
  });
}

/** Reports the window's deactivation once, from whatever path of the host's end reaches it first. */
function reportDeactivated(): void {
  const agentFolder = agentFolderOf();
  if (
    deactivatedReported ||
    agentFolder === undefined ||
    windowName === undefined
  ) {
    return;
  }
  deactivatedReported = true;
  report(agentFolder, windowName, {event: 'deactivated'});
}

/** Reports the window's deactivation when the extension host asks the extension to. */
export function deactivate(): void {
  reportDeactivated();
}
