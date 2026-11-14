/**
 * @fileoverview The entry of WSL in the web editor: the same activation with the browser's handlers and no presence
 * check, then a resolver that refuses every WSL window.
 */

import * as vscode from 'vscode';
import {type CommandManifest, identifierHost} from 'lib-identifiers';
import {createLogger} from 'lib-log';
import {standDownHost} from 'lib-standdown';
import {activateWsl} from './activation.ts';
import {RUNTIME_COMMAND_IDS} from './commands/runtime-commands.ts';
import {presenceBoundMilliseconds} from './defaults.ts';
import {
  authorities,
  commands,
  contextKeys,
  standDown,
} from './identifiers.generated.ts';
import {
  STAND_DOWN_BUTTON,
  STAND_DOWN_WARNING,
  WEB_RESOLVE_REFUSAL,
} from './strings.ts';
import {
  registerWebResolver,
  webHandlers,
  webRuntimeHandler,
} from './web-activation.ts';

/** Called by the editor when the extension activates. */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  function translate(text: string): string {
    return vscode.l10n.t(text);
  }
  const host = identifierHost(
    vscode,
    context.extension.packageJSON as CommandManifest,
  );
  const logger = createLogger(undefined, {minimumLevel: () => 'info'});
  const result = await activateWsl({
    table: {
      commands,
      runtimeCommandIds: RUNTIME_COMMAND_IDS,
      standDown,
      noDistrosKey: contextKeys.noWSLDistrosInstalled,
    },
    standDownTexts: {
      warning: translate(STAND_DOWN_WARNING),
      button: translate(STAND_DOWN_BUTTON),
    },
    standDown: standDownHost(vscode),
    commands: host,
    contextKeys: host,
    handlers: webHandlers(translate),
    runtimeHandler: webRuntimeHandler(translate),
    logger,
    presenceBoundMilliseconds,
    startTimer: () => () => undefined,
  });
  if (result.kind !== 'serving') {
    return;
  }
  context.subscriptions.push({dispose: result.dispose});
  registerWebResolver(
    {
      register: (authority, resolve) => {
        context.subscriptions.push(
          vscode.workspace.registerRemoteAuthorityResolver(authority, {
            resolve,
          }),
        );
      },
      notAvailable: message =>
        vscode.RemoteAuthorityResolverError.NotAvailable(message),
    },
    authorities.wslAuthority,
    translate(WEB_RESOLVE_REFUSAL),
    logger,
  );
}
