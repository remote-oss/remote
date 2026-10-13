/**
 * @fileoverview The editor side of the proposed-API setup: the ports the shared setup flow runs on, made of what the
 * editor offers. The notices are the extension's own texts, in the display language.
 */

import type {
  WindowClaim,
  SetupPorts,
  SetupAnswer,
  SetupNotice,
  RestartAnswer,
} from './setup.ts';
import {type ProbeApi, type ProposalName, probeProposals} from './probe.ts';
import {
  argvPath,
  type ArgvLocation,
  enabledProposedApiIds,
  isArgvFile,
} from './argv.ts';
import {type DocumentEvents, savedAndClosed} from './save-watch.ts';

/** The publisher whose extensions form the family. */
const FAMILY_PREFIX = 'remote-oss.';

const CONFIGURE_COMMAND = 'workbench.action.configureRuntimeArguments';
const QUIT_COMMAND = 'workbench.action.quit';

const DISMISSED_KEY = 'gate.dismissed';
const ATTEMPT_PENDING_KEY = 'gate.attemptPending';

/**
 * The texts the notices show, each a template in the display language: `{0}` is the extension's display name, `{1}`
 * the editor's application name, `{2}` the list of ids in the setup notice or the extension's own id in the failed
 * attempt.
 */
export interface SetupTexts {
  setup: string;
  failedAttempt: string;
  restart: string;
  configureButton: string;
  notNowButton: string;
  quitButton: string;
}

/** Puts the values into the `{n}` places of a template. */
function filled(template: string, values: readonly string[]): string {
  return values.reduce(
    (text, value, index) => text.replaceAll(`{${String(index)}}`, value),
    template,
  );
}

/** An installed extension as far as the family needs to know it. */
export interface InstalledExtension {
  id: string;
  /** The proposals its manifest declares. */
  proposals: readonly string[];
}

/** The values kept in the extension's global state. */
interface GateState {
  read(key: string): boolean | undefined;
  update(key: string, value: boolean): PromiseLike<void>;
}

/** What the setup needs from the editor. */
export interface GateEditor {
  probeApi: ProbeApi;
  installed(): PromiseLike<readonly InstalledExtension[]>;
  /** The text of the runtime-arguments file, or nothing when there is none. */
  readFile(filePath: string): PromiseLike<string | undefined>;
  state: GateState;
  documents: DocumentEvents;
  window: WindowClaim;
  /** Shows a warning with buttons and says which was chosen; closing it chooses nothing. */
  showWarning(
    text: string,
    buttons: readonly string[],
  ): PromiseLike<string | undefined>;
  showInformation(
    text: string,
    buttons: readonly string[],
  ): PromiseLike<string | undefined>;
  runCommand(command: string): PromiseLike<unknown>;
}

/** Who the setup speaks for and where it runs. */
export interface GateIdentity {
  extensionId: string;
  /** The extension's display name. */
  displayName: string;
  /** The editor's application name. */
  applicationName: string;
  proposals: readonly ProposalName[];
  /** The ids of the remote views the extension contributes; their focus commands probe `contribViewsRemote`. */
  viewIds: readonly string[];
  /** Where the runtime arguments are; the data folder is looked up when the setup needs it, never at activation. */
  argv: Omit<ArgvLocation, 'dataFolderName'> & {
    dataFolderName(): PromiseLike<string>;
  };
  /** The platform the editor runs on, which decides whether file names differ by case. */
  platform: string;
  texts: SetupTexts;
  logFailure(message: string): void;
}

/** The non-modal notices the setup shows: the button taken, or nothing when the notice is closed. */
export interface GateNotices {
  showInformation(
    text: string,
    buttons: readonly string[],
  ): PromiseLike<string | undefined>;
  showWarning(
    text: string,
    buttons: readonly string[],
  ): PromiseLike<string | undefined>;
}

/** The ids of the installed extensions of the family that declare proposals. */
function installedFamilyIds(
  installed: readonly InstalledExtension[],
): string[] {
  return installed
    .filter(
      extension =>
        extension.id.startsWith(FAMILY_PREFIX) &&
        extension.proposals.length > 0,
    )
    .map(extension => extension.id);
}

/** The ids as the notice lists them: quoted, separated by commas. */
function quotedList(identifiers: readonly string[]): string {
  return identifiers.map(identifier => `'${identifier}'`).join(', ');
}

/** The ports of the shared setup flow over the editor. */
export function setupPortsOf(
  editor: GateEditor,
  identity: GateIdentity,
): SetupPorts {
  const {texts} = identity;
  const names = [identity.displayName, identity.applicationName];
  async function resolvedArgvFile(): Promise<string | undefined> {
    try {
      return argvPath({
        ...identity.argv,
        dataFolderName: await identity.argv.dataFolderName(),
      });
    } catch (caught) {
      identity.logFailure(
        `the runtime arguments cannot be located: ${String(caught)}`,
      );
      return undefined;
    }
  }
  const configure = texts.configureButton;
  const quit = filled(texts.quitButton, names);
  function noticeText(notice: SetupNotice): string {
    return notice.kind === 'setup'
      ? filled(texts.setup, [...names, quotedList(notice.argvEntries)])
      : filled(texts.failedAttempt, [...names, identity.extensionId]);
  }
  return {
    extensionId: identity.extensionId,
    probe: () =>
      probeProposals(editor.probeApi, {
        proposals: identity.proposals,
        viewIds: identity.viewIds,
      }),
    installedFamilyIds: async () =>
      installedFamilyIds(await editor.installed()),
    argvEnabled: async () => {
      const argvFile = await resolvedArgvFile();
      return argvFile === undefined
        ? []
        : enabledProposedApiIds(await editor.readFile(argvFile), message => {
            identity.logFailure(message);
          });
    },
    flags: {
      dismissed: () => editor.state.read(DISMISSED_KEY) ?? false,
      setDismissed: value => editor.state.update(DISMISSED_KEY, value),
      attemptPending: () => editor.state.read(ATTEMPT_PENDING_KEY) ?? false,
      setAttemptPending: value =>
        editor.state.update(ATTEMPT_PENDING_KEY, value),
    },
    window: editor.window,
    showSetup: async (notice): Promise<SetupAnswer> =>
      (await editor.showWarning(noticeText(notice), [
        configure,
        texts.notNowButton,
      ])) === configure
        ? 'configure'
        : 'notNow',
    showRestart: async (): Promise<RestartAnswer> =>
      (await editor.showInformation(filled(texts.restart, names), [quit])) ===
      quit
        ? 'quit'
        : 'later',
    configureRuntimeArguments: () => editor.runCommand(CONFIGURE_COMMAND),
    argvEdited: async () => {
      const argvFile = await resolvedArgvFile();
      return (
        argvFile !== undefined &&
        (await savedAndClosed(editor.documents, documentPath =>
          isArgvFile(documentPath, argvFile, identity.platform),
        ))
      );
    },
    quit: () => editor.runCommand(QUIT_COMMAND),
    logFailure: message => {
      identity.logFailure(message);
    },
  };
}
