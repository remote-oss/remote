/**
 * @fileoverview The editor behind the proposed-API setup: the one module of the setup that touches `vscode`. It is
 * only imported for its types, so it loads without the editor, and each member is read when the setup asks.
 */

import path from 'node:path';
import {handoffStoreOf, NODE_EVENT_FILES} from 'lib-state';
import type * as vscode from 'vscode';
import {windowClaimOf} from './claim.ts';
import {probeApiOf} from './vscode-api.ts';
import type {
  AttemptHandoff,
  GateEditor,
  GateNotices,
  InstalledExtension,
} from './setup-ports.ts';

/** The folder under the extension's storage that holds the handoffs of the gate, and the one name of its handoff. */
const ATTEMPT_FOLDER = path.join('handoffs', 'gate-attempt');
const ATTEMPT_KEY = 'attempt';

/** The handoff of a failed attempt in the extension's storage folder `storageFolder`, on the clock `now`. */
export function attemptHandoffOf(
  storageFolder: string,
  now: () => number,
): AttemptHandoff {
  const store = handoffStoreOf({
    folder: path.join(storageFolder, ATTEMPT_FOLDER),
    files: NODE_EVENT_FILES,
    now,
    isValue: (value): value is true => value === true,
  });
  return {
    pending: () => store.peek(ATTEMPT_KEY) !== undefined,
    leave: () => store.leave(ATTEMPT_KEY, true),
    take: () => store.take(ATTEMPT_KEY) !== undefined,
  };
}

/** The prefix of the ids of the family's extensions, whose manifests the setup reads from their files. */
const FAMILY_ID_PREFIX = 'remote-oss.';

/** What the editor's extension object gives of an installed extension. */
interface InstalledObject {
  id: string;
  extensionPath: string;
}

/** The proposals a manifest file declares: none when the file cannot be read or is not a manifest. */
async function declaredIn(
  extension: InstalledObject,
  readFile: (filePath: string) => Promise<string | undefined>,
  logFailure: (message: string) => void,
): Promise<readonly string[]> {
  const file = path.join(extension.extensionPath, 'package.json');
  const text = await readFile(file);
  if (text === undefined) {
    logFailure(`the manifest of ${extension.id} cannot be read: ${file}`);
    return [];
  }
  try {
    const proposals = (JSON.parse(text) as {enabledApiProposals?: unknown})
      .enabledApiProposals;
    return Array.isArray(proposals)
      ? proposals.filter((item): item is string => typeof item === 'string')
      : [];
  } catch (caught) {
    logFailure(
      `the manifest of ${extension.id} cannot be parsed: ${String(caught)}`,
    );
    return [];
  }
}

/**
 * The installed extensions as the setup needs them. The editor strips the proposals it does not allow from the
 * manifests it keeps in memory, so a member of the family declares what its own `package.json` says. Other extensions
 * declare nothing here: the setup reads no file of theirs.
 */
async function installedFrom(
  extensions: readonly InstalledObject[],
  readFile: (filePath: string) => Promise<string | undefined>,
  logFailure: (message: string) => void,
): Promise<InstalledExtension[]> {
  return await Promise.all(
    extensions.map(async extension => ({
      id: extension.id,
      proposals: extension.id.startsWith(FAMILY_ID_PREFIX)
        ? await declaredIn(extension, readFile, logFailure)
        : [],
    })),
  );
}

/** The setup's view of the editor. `subscriptions` is the extension's list of things released on deactivation. */
export function gateEditorOf(
  editor: typeof vscode,
  context: Pick<vscode.ExtensionContext, 'globalState' | 'subscriptions'> & {
    globalStorageUri: Pick<vscode.Uri, 'fsPath'>;
  },
  readFile: (filePath: string) => Promise<string | undefined>,
  logFailure: (message: string) => void,
  notices: GateNotices,
): GateEditor {
  return {
    probeApi: probeApiOf(editor),
    installed: () => installedFrom(editor.extensions.all, readFile, logFailure),
    readFile,
    state: {
      read: key => context.globalState.get<boolean>(key),
      update: (key, value) => context.globalState.update(key, value),
    },
    attempt: attemptHandoffOf(context.globalStorageUri.fsPath, Date.now),
    documents: {
      onSaved: listener =>
        editor.workspace.onDidSaveTextDocument(document => {
          listener(document.uri.fsPath);
        }),
      onClosed: listener =>
        editor.workspace.onDidCloseTextDocument(document => {
          listener(document.uri.fsPath);
        }),
    },
    window: windowClaimOf(
      {
        registerCommand: (command, handler) =>
          editor.commands.registerCommand(command, handler),
        executeCommand: command => editor.commands.executeCommand(command),
      },
      context.subscriptions,
    ),
    showWarning: (text, buttons) => notices.showWarning(text, buttons),
    showInformation: (text, buttons) => notices.showInformation(text, buttons),
    runCommand: command => editor.commands.executeCommand(command),
  };
}
