/**
 * @fileoverview The activation of Dev Containers: the stand-down guard first, then the log channel, then the
 * proposed-API setup, and only then the commands the package registers. Nothing is opened or registered when the
 * package stands down.
 */

import type {SetupPorts, SetupRun} from 'lib-authority';
import {runSetup} from 'lib-authority';
import {
  type CommandEntry,
  type CommandHandler,
  type CommandHost,
  registerCommands,
} from 'lib-identifiers';
import {
  createChannelSink,
  createLogger,
  type EditorLogPort,
  type Logger,
} from 'lib-log';
import {standDownIfPresent, type StandDownHost} from 'lib-standdown';
import type {PreflightDependencies} from './engine/preflight.ts';
import type {TrustPort} from './trust/trust-gate.ts';

/** The part of the package's identifier table that activation uses. */
export interface ContainersTable<
  Commands extends Readonly<Record<string, CommandEntry>>,
> {
  readonly commands: Commands;
  readonly standDown: {
    readonly standsDownFor: string;
    readonly contextKey: string;
  };
}

/** What the version line of the log names. */
interface BannerFacts {
  displayName: string;
  extensionVersion: string;
  /** The editor's application name, its version and its commit. */
  editorName: string;
  editorVersion: string;
  editorCommit: string;
}

/** What a serving window offers the code that registers in it. */
interface ServedWindow {
  readonly logger: Logger;
  /** The checks of the Docker CLI, over the window's log. */
  readonly preflight: PreflightDependencies;
  /** The proposals the activation's probe found missing, as the setup's decision names them. */
  readonly missing: readonly string[];
  /** What the open commands read and ask of the editor's workspace trust; activation never calls it. */
  readonly trust: TrustPort;
  /** Runs the setup again after a use that needs a proposal failed; it never stores a success it did not probe. */
  setupAgain(): Promise<SetupRun>;
}

/** Everything activation needs from its surroundings. */
export interface ContainersActivationInputs<
  Commands extends Readonly<Record<string, CommandEntry>>,
> {
  table: ContainersTable<Commands>;
  /** The coexistence warning and its button, in the user's language. */
  standDownTexts: {warning: string; button: string};
  standDown: StandDownHost;
  commands: CommandHost;
  channels: Pick<EditorLogPort, 'createOutputChannel'>;
  clock: () => number;
  banner: BannerFacts;
  /** The surroundings of the Docker CLI checks, made once the log is open. */
  preflight(logger: Logger): PreflightDependencies;
  /** The editor's workspace trust, which the open commands ask. */
  trust: TrustPort;
  /** The ports of the proposed-API setup, made once the log is open; `logFailure` writes to it. */
  gate(logFailure: (message: string) => void): SetupPorts;
  /** The handler of every command of the table, made once the window serves. */
  handlers(served: ServedWindow): {
    readonly [Name in keyof Commands]: CommandHandler;
  };
}

/** How activation ended: the package stands down, or it serves with the end of what it opened. */
export type ContainersActivation =
  | {kind: 'standing'}
  | {
      kind: 'serving';
      served: ServedWindow;
      setup: SetupRun['interaction'];
      dispose(): void;
    };

/** The name of the log channel. */
const CHANNEL_NAME = 'Dev Containers';

/**
 * Runs the activation. On `standing` nothing has been opened or registered. On `serving` the log channel is open and
 * the commands are registered whatever the setup found; `dispose` undoes both. A failing setup or registration
 * closes the channel and fails the activation.
 */
export async function activateContainers<
  Commands extends Readonly<Record<string, CommandEntry>>,
>(inputs: ContainersActivationInputs<Commands>): Promise<ContainersActivation> {
  const {table, banner} = inputs;
  const outcome = await standDownIfPresent(inputs.standDown, {
    ...inputs.standDownTexts,
    standsDownFor: table.standDown.standsDownFor,
    standingDownKey: table.standDown.contextKey,
  });
  if (outcome === 'standing') {
    return {kind: 'standing'};
  }
  const sink = createChannelSink(inputs.channels, CHANNEL_NAME);
  const logger = createLogger(sink, {
    minimumLevel: () => 'info',
    clock: inputs.clock,
  });
  logger.info(
    `${banner.displayName} ${banner.extensionVersion} in ${banner.editorName} ${banner.editorVersion} (${banner.editorCommit}).`,
  );
  logger.info('Initializing configuration support...');
  logger.info('Internal initialization of dev container support package...');
  try {
    const ports = inputs.gate(message => {
      logger.error(message);
    });
    const setup = await runSetup(ports, true);
    const missing = setup.decision.missing;
    if (missing.length > 0) {
      logger.info(`Missing proposed APIs: ${missing.join(', ')}`);
    }
    const served: ServedWindow = {
      logger,
      preflight: inputs.preflight(logger),
      missing,
      trust: inputs.trust,
      setupAgain: () => runSetup(ports, false),
    };
    const registration = registerCommands(
      inputs.commands,
      outcome,
      table.commands,
      inputs.handlers(served),
    );
    return {
      kind: 'serving',
      served,
      setup: setup.interaction,
      dispose: () => {
        registration.dispose();
        sink.dispose();
      },
    };
  } catch (caught) {
    sink.dispose();
    throw caught;
  }
}
