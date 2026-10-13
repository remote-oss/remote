import {appendFileSync, existsSync, mkdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import {windowNameOf} from './window-name.ts';

/** How often the agent looks for a new command, in milliseconds. */
const POLL_MILLISECONDS = 200;

/** A command a test wrote for this window. */
interface AgentCommand {
  id: string;
  command: string;
  parameters?: unknown[];
}

/** The name of this window, from its first workspace folder. */
function windowName(): string {
  return windowNameOf(vscode.workspace.workspaceFolders?.[0]?.uri.path);
}

/** A file of this window's agent in the run's folder: its `events` or its `commands`. */
function agentFile(runFolder: string, kind: 'events' | 'commands'): string {
  const folder = path.join(runFolder, 'agent');
  mkdirSync(folder, {recursive: true});
  return path.join(folder, `${windowName()}.${kind}.jsonl`);
}

/** Appends one event as a single write, so that two windows never split a line. */
function report(runFolder: string, event: Record<string, unknown>): void {
  appendFileSync(
    agentFile(runFolder, 'events'),
    `${JSON.stringify({...event, time: Date.now()})}\n`,
  );
}

/** The ids of the commands this window's agent, in any of its starts, has accepted. */
function acceptedIds(runFolder: string): Set<string> {
  const file = agentFile(runFolder, 'events');
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
function pendingCommands(runFolder: string): AgentCommand[] {
  const file = agentFile(runFolder, 'commands');
  if (!existsSync(file)) {
    return [];
  }
  const accepted = acceptedIds(runFolder);
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line !== '')
    .map(line => JSON.parse(line) as AgentCommand)
    .filter(each => !accepted.has(each.id));
}

/** Runs one command: `accepted` first, since a reload or a close may never write `done`. */
async function execute(runFolder: string, each: AgentCommand): Promise<void> {
  report(runFolder, {event: 'accepted', id: each.id});
  try {
    await vscode.commands.executeCommand(
      each.command,
      ...(each.parameters ?? []),
    );
    report(runFolder, {event: 'done', id: each.id});
  } catch (error) {
    report(runFolder, {
      event: 'failed',
      id: each.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The run's folder when the harness is on; the agent does nothing without it. */
function runFolderOf(): string | undefined {
  const folder = process.env.HARNESS_RUN_FOLDER;
  return folder === undefined || folder === '' ? undefined : folder;
}

/** Starts the agent: reports the window's activation, registers its own commands and polls for the test's commands. */
export function activate(context: vscode.ExtensionContext): void {
  const runFolder = runFolderOf();
  if (runFolder === undefined) {
    return;
  }
  report(runFolder, {event: 'activated'});
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'acceptance.agent.openWindow',
      (uri: string) => {
        // The command ends when the new window closes, not when it opens, so the agent does not wait for it.
        void vscode.commands.executeCommand(
          'vscode.openFolder',
          vscode.Uri.parse(uri),
          {forceNewWindow: true},
        );
      },
    ),
    vscode.commands.registerCommand('acceptance.agent.state', () => {
      report(runFolder, {
        event: 'state',
        remoteName: vscode.env.remoteName ?? null,
        folders: (vscode.workspace.workspaceFolders ?? []).map(each =>
          each.uri.toString(),
        ),
      });
    }),
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
        report(runFolder, {
          event: 'forwarded',
          localAddress: tunnel.localAddress,
          remotePort,
        });
      },
    ),
    vscode.commands.registerCommand(
      'acceptance.agent.writeFile',
      async (name: string, text: string) => {
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (folder === undefined) {
          throw new Error('the window has no folder');
        }
        await vscode.workspace.fs.writeFile(
          vscode.Uri.joinPath(folder, name),
          new TextEncoder().encode(text),
        );
      },
    ),
  );
  let busy = false;
  const timer = setInterval(() => {
    if (busy) {
      return;
    }
    busy = true;
    const waiting = pendingCommands(runFolder);
    void (async () => {
      for (const each of waiting) {
        await execute(runFolder, each);
      }
      busy = false;
    })();
  }, POLL_MILLISECONDS);
  context.subscriptions.push({
    dispose: () => {
      clearInterval(timer);
    },
  });
}

/** Reports the window's deactivation. */
export function deactivate(): void {
  const runFolder = runFolderOf();
  if (runFolder !== undefined) {
    report(runFolder, {event: 'deactivated'});
  }
}
