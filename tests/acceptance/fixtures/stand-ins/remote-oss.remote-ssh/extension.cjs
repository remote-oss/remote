/**
 * @fileoverview The acceptance stand-in for the SSH companion: it carries the companion's id and registers the commands
 * the Remote Explorer calls. How each call ends is read at the call from the file that REMOTE_OSS_ACCEPTANCE_STAND_IN_MODE
 * names, a JSON object keyed by command id whose values are `{"answer": <value>}`, `{"reject": "<message>"}`,
 * `{"never": true}` or `{"showErrorThenReject": "<text>"}`. A call the file does not name gets the reply of an empty
 * companion. Nothing else is read, written or opened.
 */

const nodeFs = require('node:fs');
const vscode = require('vscode');

/** The interface version the explorer speaks. */
const INTERFACE_VERSION = {major: 1, minor: 0};

/** What a call answers when the file names no mode for it: the reply of a companion with nothing to say. */
const DEFAULT_ANSWERS = {
  'remote-internal.getActiveSshRemote': {
    interfaceVersion: INTERFACE_VERSION,
    connected: false,
  },
  'remote-internal.getConfiguredHostnames': {
    interfaceVersion: INTERFACE_VERSION,
    hostnames: [],
  },
  'remote-internal.getSshFoldersHistory': {
    interfaceVersion: INTERFACE_VERSION,
    hosts: [],
  },
  'remote-internal.deleteSshFolderFromHistory': {
    interfaceVersion: INTERFACE_VERSION,
    changed: false,
  },
  'opensshremotes.openConfigFile': undefined,
  'opensshremotes.addNewSshHost': undefined,
};

/** The mode the file names for `commandId` now; none when the file is missing, unreadable or names no mode for it. */
function modeOf(commandId) {
  const file = process.env.REMOTE_OSS_ACCEPTANCE_STAND_IN_MODE;
  try {
    return JSON.parse(nodeFs.readFileSync(file, 'utf8'))[commandId];
  } catch {
    return undefined;
  }
}

/** How the call to `commandId` ends. */
function answerTo(commandId) {
  const mode = modeOf(commandId);
  if (mode === undefined || mode === null) {
    return Promise.resolve(DEFAULT_ANSWERS[commandId]);
  }
  if ('answer' in mode) {
    return Promise.resolve(mode.answer);
  }
  if ('reject' in mode) {
    return Promise.reject(new Error(mode.reject));
  }
  if ('showErrorThenReject' in mode) {
    void vscode.window.showErrorMessage(mode.showErrorThenReject);
    return Promise.reject(new Error(mode.showErrorThenReject));
  }
  if ('never' in mode) {
    return new Promise(() => undefined);
  }
  return Promise.resolve(DEFAULT_ANSWERS[commandId]);
}

/** Registers every command of the companion that the explorer calls. */
function activate(context) {
  for (const commandId of Object.keys(DEFAULT_ANSWERS)) {
    context.subscriptions.push(
      vscode.commands.registerCommand(commandId, () => answerTo(commandId)),
    );
  }
}

module.exports = {activate};
