/**
 * @fileoverview The entry of Remote Explorer in the desktop editor: it hands the editor to the activation, with the
 * strings of the stand-down warning and of the proposed-API setup.
 */

import {readFile} from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';
import {familySetupPortsOf, runSetup} from 'lib-authority';
import {identifierHost} from 'lib-identifiers';
import {profileOf} from 'lib-product';
import {standDownHost} from 'lib-standdown';
import {activateExplorer, silentHandlers} from './activation.ts';
import {
  commands,
  enabledApiProposals,
  standDown,
  views,
} from './identifiers.generated.ts';

/** The warning of a window where the other Remote Explorer runs, and its button. */
const STAND_DOWN_WARNING =
  'Remote Explorer stays inactive in this window because another Remote Explorer extension is enabled. Both use the same commands, settings and views. Disable one of the two and reload the window.';
const STAND_DOWN_BUTTON = 'Show Remote Explorer Extension';

/** The English templates of the proposed-API setup notices; the placeholders are filled by the setup. */
const SETUP_TEXT_TEMPLATES = {
  setup:
    "{0} needs proposed VS Code APIs that {1} has not enabled for it. Add {2} to 'enable-proposed-api' in argv.json, then restart {1}.",
  failedAttempt:
    "The previous setup attempt did not enable the proposed APIs {0} needs. Check that 'enable-proposed-api' in argv.json lists 'remote-oss.remote-explorer', then restart {1}.",
  restart: 'Quit and start {1} again to apply the changes to argv.json.',
  configureButton: 'Configure Runtime Arguments',
  notNowButton: 'Not Now',
  quitButton: 'Quit {1}',
};

/** What the editor tells about the extension, as far as activation reads it. */
interface Manifest {
  displayName: string;
  contributes?: {commands?: Array<{command: string; title: string}>};
}

function translate(template: string): string {
  return vscode.l10n.t(template);
}

/** The `dataFolderName` of the editor's product, which names the folder of its runtime arguments. */
async function dataFolderName(): Promise<string> {
  return profileOf(
    await readFile(path.join(vscode.env.appRoot, 'product.json'), 'utf8'),
  ).dataFolderName;
}

/** Called by the editor when the extension activates. */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const manifest = context.extension.packageJSON as Manifest;
  const result = await activateExplorer({
    table: {commands, standDown},
    standDownTexts: {
      warning: translate(STAND_DOWN_WARNING),
      button: translate(STAND_DOWN_BUTTON),
    },
    standDown: standDownHost(vscode),
    commands: identifierHost(vscode, manifest),
    handlers: silentHandlers(commands),
    setup: () =>
      runSetup(
        familySetupPortsOf(vscode, context, {
          displayName: manifest.displayName,
          proposals: enabledApiProposals,
          viewIds: [views.remoteTargets],
          templates: SETUP_TEXT_TEMPLATES,
          translate,
          dataFolderName,
          logFailure: () => undefined,
        }),
        true,
      ),
  });
  if (result.kind === 'serving') {
    context.subscriptions.push({
      dispose: () => {
        result.dispose();
      },
    });
  }
}
