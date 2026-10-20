/**
 * @fileoverview The activation of Remote Explorer in a window, shared by the desktop and the web entry: the
 * stand-down guard, the entry's setup, and the commands, with the end of what was registered added to the context.
 */

import {
  commandBus,
  createDetector,
  createProtocol,
  extensionLookup,
  systemTimers,
} from 'lib-companion';
import {identifierHost} from 'lib-identifiers';
import {standDownHost} from 'lib-standdown';
import type * as vscode from 'vscode';
import {activateExplorer, silentHandlers} from './activation.ts';
import {serveInbox} from './companion/inbox.ts';
import {commands, standDown, views} from './identifiers.generated.ts';
import {companionCallsOf} from './view/companion-calls.ts';
import {connectHandlers} from './view/connect.ts';
import {handOverHandlers} from './view/hand-overs.ts';
import type {ClientPlatform} from './model/ssh-group.ts';
import {createTargets, type ViewSession} from './view/targets.ts';
import {
  configFileChangesOf,
  folderSettingsOf,
  showTargets,
  type TreeEditor,
} from './view/tree-adapter.ts';

/** The warning of a window where the other Remote Explorer runs, and its button. */
const STAND_DOWN_WARNING =
  'Remote Explorer stays inactive in this window because another Remote Explorer extension is enabled. Both use the same commands, settings and views. Disable one of the two and reload the window.';
const STAND_DOWN_BUTTON = 'Show Remote Explorer Extension';

/** What the editor tells about the extension, as far as activation reads it. */
interface Manifest {
  displayName: string;
  contributes?: {commands?: Array<{command: string; title: string}>};
}

/** The part of the editor API the window's activation uses; the entry passes the real `vscode` module. */
export type WindowEditor = TreeEditor &
  Pick<typeof vscode, 'extensions' | 'l10n'>;

/**
 * Activates the explorer in this window: the stand-down guard, `setup`, then the commands. On `serving` the end of
 * the registration is added to `context.subscriptions`. `clientPlatform` is the platform the editor's client runs on.
 */
export async function activateInWindow(
  editor: WindowEditor,
  context: Pick<vscode.ExtensionContext, 'subscriptions' | 'extension'>,
  setup: () => PromiseLike<unknown>,
  clientPlatform: ClientPlatform,
): Promise<void> {
  let session: ViewSession | undefined = undefined;
  const result = await activateExplorer({
    table: {commands, standDown},
    standDownTexts: {
      warning: editor.l10n.t(STAND_DOWN_WARNING),
      button: editor.l10n.t(STAND_DOWN_BUTTON),
    },
    standDown: standDownHost(editor),
    commands: identifierHost(editor, context.extension.packageJSON as Manifest),
    handlers: {
      ...silentHandlers(commands),
      refresh: {execute: () => session?.targets.rebuild()},
      ...connectHandlers(() => session),
      ...handOverHandlers(() => session, editor.commands),
    },
    setup,
  });
  if (result.kind !== 'serving') {
    return;
  }
  context.subscriptions.push({
    dispose: () => {
      result.dispose();
    },
  });
  const protocol = createProtocol({
    // eslint-disable-next-line id-length -- the protocol's option is named bus
    bus: commandBus(editor),
    timers: systemTimers,
  });
  context.subscriptions.push(serveInbox(protocol, () => session?.targets));
  const calls = companionCallsOf(protocol);
  const detector = createDetector(extensionLookup(editor));
  const targets = createTargets({
    calls,
    detector,
    configFileChanges: configFileChangesOf(editor),
    connectedText: editor.l10n.t('connected'),
    folderSettings: folderSettingsOf(editor),
    clientPlatform,
  });
  const shown = await showTargets(editor, targets, views.remoteTargets);
  const disposables = [targets, detector];
  if (shown === undefined) {
    for (const disposable of disposables) {
      disposable.dispose();
    }
    return;
  }
  session = {targets, calls};
  void targets.rebuild();
  context.subscriptions.push({
    dispose: () => {
      for (const disposable of [shown, ...disposables]) {
        disposable.dispose();
      }
    },
  });
}
