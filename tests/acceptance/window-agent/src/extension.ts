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
  args?: unknown[];
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

/** The lines of the commands file this window has not run yet. */
function pendingCommands(runFolder: string, done: number): AgentCommand[] {
  const file = agentFile(runFolder, 'commands');
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line !== '')
    .slice(done)
    .map(line => JSON.parse(line) as AgentCommand);
}

/** Runs one command: `accepted` first, since a reload or a close may never write `done`. */
async function run(runFolder: string, each: AgentCommand): Promise<void> {
  report(runFolder, {event: 'accepted', id: each.id});
  try {
    await vscode.commands.executeCommand(each.command, ...(each.args ?? []));
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

export function activate(context: vscode.ExtensionContext): void {
  const runFolder = runFolderOf();
  if (runFolder === undefined) {
    return;
  }
  report(runFolder, {event: 'activated'});
  context.subscriptions.push(
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
  // A reload starts the agent again: the commands already in the file ran in a window that no longer exists.
  let done = pendingCommands(runFolder, 0).length;
  let busy = false;
  const timer = setInterval(() => {
    if (busy) {
      return;
    }
    busy = true;
    const waiting = pendingCommands(runFolder, done);
    done += waiting.length;
    void (async () => {
      for (const each of waiting) {
        await run(runFolder, each);
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

export function deactivate(): void {
  const runFolder = runFolderOf();
  if (runFolder !== undefined) {
    report(runFolder, {event: 'deactivated'});
  }
}
