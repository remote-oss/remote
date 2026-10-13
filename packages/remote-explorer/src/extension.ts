/**
 * @fileoverview The entry of Remote Explorer in the desktop editor: it hands the editor to the activation of the
 * window, with the proposed-API setup and its strings.
 */

import {readFile} from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';
import {familySetupPortsOf, runSetup} from 'lib-authority';
import {profileOf} from 'lib-product';
import {enabledApiProposals, views} from './identifiers.generated.ts';
import {activateInWindow} from './window-activation.ts';

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
export function activate(context: vscode.ExtensionContext): Promise<void> {
  const manifest = context.extension.packageJSON as Manifest;
  return activateInWindow(vscode, context, () =>
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
  );
}
