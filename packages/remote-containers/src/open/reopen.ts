/**
 * @fileoverview The Reopen in Container command for a local window with one folder: it checks the engine, has a
 * configuration chosen and read, and reloads the same window on a dev-container authority at the folder the container
 * will show. It never creates or starts a container; the resolve does.
 */

import {encodeAuthority, openRemote} from 'lib-authority';
import {devContainerPayloadOf} from '../authority/payload.ts';
import type {CliFailure} from '../cli/cli-lines.ts';
import {chooseConfiguration} from '../config/choose-configuration.ts';
import {type Executable, executableOf} from '../engine/executable.ts';
import type {ReopenPorts} from './reopen-ports.ts';

/** What a CLI failure says in the log: its kind and, when it has one, its message. */
function failureText(failure: CliFailure): string {
  return 'message' in failure
    ? `${failure.kind}: ${failure.message}`
    : failure.kind;
}

/** The handler of the command over `ports`. A call made while another runs returns at once. */
export function reopenInContainer(ports: ReopenPorts): () => Promise<void> {
  const {window, logger} = ports;
  let running = false;

  /** The folder to reopen when this window is a local one with a single trusted `file` folder. */
  function folderToReopen(): string | undefined {
    const folders = window.folders();
    const [only] = folders;
    if (
      window.remoteName() !== undefined ||
      folders.length !== 1 ||
      only?.scheme !== 'file'
    ) {
      logger.info('Reopen in Container does nothing in this window');
      return undefined;
    }
    if (!window.isTrusted()) {
      logger.info(
        "the folder isn't trusted; Reopen in Container needs workspace trust",
      );
      return undefined;
    }
    return only.fsPath;
  }

  async function attempt(): Promise<void> {
    const folder = folderToReopen();
    if (folder === undefined) {
      return;
    }
    if ((await ports.engine.firstCheck(folder)) === 'stopped') {
      return;
    }
    // With the folder as base, the setting always names a program.
    const executable = executableOf(
      ports.settings.dockerPath(),
      folder,
    ) as Extract<Executable, {kind: 'spawn'}>;
    const choice = await chooseConfiguration(
      {
        folder,
        dockerPath: executable.file,
        cancellation: new AbortController().signal,
      },
      // eslint-disable-next-line id-length -- the choice's dependency is named cli
      {...ports.config, cli: ports.bridge, logger},
    );
    if (choice.kind === 'noConfiguration') {
      logger.info(`Reopen in Container found no configuration in ${folder}`);
      return;
    }
    if (choice.kind === 'readFailed') {
      logger.warn(
        `Reopen in Container could not read the configuration: ${failureText(choice.failure)}`,
      );
      return;
    }
    if (choice.kind !== 'chosen') {
      return;
    }
    const context = await ports.engine.currentContext(executable.file);
    const payload = devContainerPayloadOf({
      kind: 'folder',
      hostPath: folder,
      localDocker: false,
      ...(context === undefined ? {} : {context}),
      configFile: window.serializedFile(choice.configFile),
    });
    const opened = await openRemote(
      ports.opener,
      encodeAuthority({
        family: 'dev-container',
        target: {payload},
        rawHostString: payload,
      }),
      {path: choice.workspaceFolder, pathKind: 'folder', target: 'current'},
    );
    if (opened.kind === 'rejected') {
      logger.warn(`Reopen in Container was refused: ${opened.reason}`);
    }
  }

  return async () => {
    if (running) {
      logger.info('Reopen in Container is already running');
      return;
    }
    running = true;
    try {
      await attempt();
    } finally {
      running = false;
    }
  };
}
