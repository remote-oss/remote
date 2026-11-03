/**
 * @fileoverview The acceptance stand-in for the SSH companion: it carries the companion's id and registers the commands
 * the Remote Explorer calls. How each call ends is read at the call from the file that REMOTE_OSS_ACCEPTANCE_STAND_IN_MODE
 * names, a JSON object keyed by command id whose values are `{"answer": <value>}`, `{"reject": "<message>"}`,
 * `{"never": true}` or `{"showErrorThenReject": "<text>"}`. A call the file does not name gets the reply of an empty
 * companion. Nothing else is read, written or opened.
 */

const nodeFs = require('node:fs');
const vscode = require('vscode');

/** The commands whose reply is an empty envelope, with the member that makes it empty. */
const EMPTY_REPLIES = {
  'remote-internal.getActiveSshRemote': {connected: false},
  'remote-internal.getConfiguredHostnames': {hostnames: []},
  'remote-internal.getSshFoldersHistory': {hosts: []},
  'remote-internal.deleteSshFolderFromHistory': {changed: false},
};

/** The commands that reply with nothing. */
const SILENT_COMMANDS = [
  'opensshremotes.openConfigFile',
  'opensshremotes.addNewSshHost',
];

/**
 * What a call answers when the file names no mode for it: the reply of a companion with nothing to say, in the interface
 * version the call itself carries, so that a new version of the interface needs no change here.
 */
function defaultAnswerTo(commandId, request) {
  const empty = EMPTY_REPLIES[commandId];
  return empty === undefined
    ? undefined
    : {interfaceVersion: request?.interfaceVersion, ...empty};
}

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
function answerTo(commandId, request) {
  const mode = modeOf(commandId);
  if (mode === undefined || mode === null) {
    return Promise.resolve(defaultAnswerTo(commandId, request));
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
  return Promise.resolve(defaultAnswerTo(commandId, request));
}

/** Registers every command of the companion that the explorer calls. */
function activate(context) {
  for (const commandId of [...Object.keys(EMPTY_REPLIES), ...SILENT_COMMANDS]) {
    context.subscriptions.push(
      vscode.commands.registerCommand(commandId, request =>
        answerTo(commandId, request),
      ),
    );
  }
}

module.exports = {activate};
