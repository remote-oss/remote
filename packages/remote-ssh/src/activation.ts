/**
 * @fileoverview The activation of Remote - SSH: the stand-down guard first, and only when it says to serve, the log
 * channel and the commands this package serves. Nothing is registered before the guard has decided, and nothing at
 * all when it stands down.
 */

import {
  type CommandEntry,
  type CommandHost,
  registerCommands,
  readSetting,
  type SettingEntry,
  type SettingHost,
} from 'lib-identifiers';
import {
  type ProposalName,
  type ProposalProbe,
  runSetup,
  type SetupPorts,
  type SetupRun,
} from 'lib-authority';
import type {Logger} from 'lib-log';
import {standDownIfPresent, type StandDownHost} from 'lib-standdown';
import {
  helpHandlers,
  type HelpEditor,
  type HelpExtension,
  type HelpLinks,
} from './help-commands.ts';
import {
  type ChannelPort,
  levelOfSetting,
  type LogEnvironment,
  openLogChannel,
} from './log-channel.ts';

/** The part of the package's identifier table that activation uses. */
export interface ActivationTable {
  readonly commands: {
    readonly showLog: CommandEntry;
    readonly getHelp: CommandEntry;
    readonly getStarted: CommandEntry;
    readonly provideFeedback: CommandEntry;
    readonly settings: CommandEntry;
    readonly reportIssue: CommandEntry;
  };
  readonly settings: {readonly logLevel: SettingEntry};
  readonly standDown: {
    readonly standsDownFor: string;
    readonly contextKey: string;
  };
}

/** Everything activation needs from its surroundings. */
export interface ActivationInputs {
  table: ActivationTable;
  extension: HelpExtension & {name: string; version: string};
  /** The help addresses; read only once the guard has decided to serve. */
  links: () => HelpLinks;
  environment: Omit<LogEnvironment, 'extensionName' | 'extensionVersion'>;
  /** The warning and its button for a window where the other extension runs, in the user's language. */
  standDownTexts: {warning: string; button: string};
  standDown: StandDownHost;
  commands: CommandHost;
  settings: SettingHost;
  help: HelpEditor;
  channels: ChannelPort;
  clock: () => number;
  /** The ports of the proposed-API setup, made once the log channel is open; `logFailure` writes to it. */
  gate: (logFailure: (message: string) => void) => SetupPorts;
}

/** The proposals the editor granted and the ones it did not, as the probe found them. */
interface ProposalGrants {
  granted: readonly ProposalName[];
  missing: readonly ProposalName[];
}

/** Runs the setup over `ports` and reports what its probe found, which the decision alone does not carry. */
async function probedSetup(
  ports: SetupPorts,
): Promise<{setupRun: SetupRun; proposals: ProposalGrants}> {
  let probes: readonly ProposalProbe[] = [];
  const setupRun = await runSetup(
    {
      ...ports,
      probe: async () => {
        probes = await ports.probe();
        return probes;
      },
    },
    true,
  );
  function named(state: ProposalProbe['state']): ProposalName[] {
    return probes
      .filter(probe => probe.state === state)
      .map(probe => probe.proposal);
  }
  return {
    setupRun,
    proposals: {granted: named('granted'), missing: named('missing')},
  };
}

/**
 * How activation ended: the package stands down, or it serves with its logger, the run of the proposed-API setup
 * (whose `interaction` the activation does not wait for) and an end for what it opened.
 */
export type ActivationResult =
  | {kind: 'standing'}
  | {
      kind: 'serving';
      logger: Logger;
      /** Reveals the log channel, as Show Log does. */
      revealLog(): void;
      proposals: ProposalGrants;
      setup: SetupRun['interaction'];
      dispose(): void;
    };

/**
 * Runs the activation: the stand-down guard, then the log channel, then the proposed-API gate, then the commands.
 * On `standing` nothing has been opened or registered. On `serving` the log channel is open and the commands are
 * registered whatever the gate found, since none of them needs a proposal; `dispose` undoes both.
 */
export async function activateRemoteSsh(
  inputs: ActivationInputs,
): Promise<ActivationResult> {
  const {table, extension} = inputs;
  const outcome = await standDownIfPresent(inputs.standDown, {
    standsDownFor: table.standDown.standsDownFor,
    standingDownKey: table.standDown.contextKey,
    warning: inputs.standDownTexts.warning,
    button: inputs.standDownTexts.button,
  });
  if (outcome === 'standing') {
    return {kind: 'standing'};
  }
  const logChannel = openLogChannel(
    inputs.channels,
    {
      ...inputs.environment,
      extensionName: extension.name,
      extensionVersion: extension.version,
    },
    () => levelOfSetting(readSetting(inputs.settings, table.settings.logLevel)),
    inputs.clock,
  );
  let probed: Awaited<ReturnType<typeof probedSetup>>;
  try {
    probed = await probedSetup(
      inputs.gate(message => {
        logChannel.logger.error(message);
      }),
    );
  } catch (caught) {
    logChannel.dispose();
    throw caught;
  }
  if (probed.proposals.missing.length > 0) {
    logChannel.logger.info(
      `Missing proposed APIs: ${probed.proposals.missing.join(', ')}`,
    );
  }
  // Only the commands this module serves: the table may hold every command of the manifest.
  const served = {
    showLog: table.commands.showLog,
    getHelp: table.commands.getHelp,
    getStarted: table.commands.getStarted,
    provideFeedback: table.commands.provideFeedback,
    settings: table.commands.settings,
    reportIssue: table.commands.reportIssue,
  };
  let registration: ReturnType<typeof registerCommands>;
  try {
    registration = registerCommands(inputs.commands, outcome, served, {
      showLog: {
        execute: () => {
          logChannel.reveal();
        },
      },
      ...helpHandlers(inputs.help, inputs.links(), extension),
    });
  } catch (caught) {
    logChannel.dispose();
    throw caught;
  }
  return {
    kind: 'serving',
    logger: logChannel.logger,
    revealLog: () => {
      logChannel.reveal();
    },
    proposals: probed.proposals,
    setup: probed.setupRun.interaction,
    dispose: () => {
      registration.dispose();
      logChannel.dispose();
    },
  };
}
