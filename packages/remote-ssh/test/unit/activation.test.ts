import {deepStrictEqual} from 'node:assert';
import type {CommandEntry, SettingInspection} from 'lib-identifiers';
import {
  commands,
  settings,
  standDown,
} from '../../src/identifiers.generated.ts';
import type {ProposalName} from 'lib-authority';
import {recordingSetupPorts} from 'lib-authority/testing/recording-setup-ports';
import type {RevealableChannel} from 'lib-log';
import type {StandDownHost} from 'lib-standdown';
import {
  type ActivationInputs,
  type ActivationTable,
  activateRemoteSsh,
} from '../../src/activation.ts';

function command(name: string): CommandEntry {
  return {
    id: `opensshremotes.${name}`,
    title: `%commands.${name}.title%`,
    palette: true,
    policy: 'silent',
  };
}

const TABLE: ActivationTable = {
  commands: {
    showLog: command('showLog'),
    getHelp: command('getHelp'),
    getStarted: command('getStarted'),
    provideFeedback: command('provideFeedback'),
    settings: command('settings'),
    reportIssue: command('reportIssue'),
    openConfigFile: command('openConfigFile'),
  },
  settings: {logLevel: {id: 'remote.SSH.logLevel', scope: 'application'}},
  standDown: {
    standsDownFor: 'ms-vscode-remote.remote-ssh',
    contextKey: 'opensshremotes.standingDown',
  },
};

/** Everything the fake surroundings saw, in the order it happened. */
interface Seen {
  events: string[];
  registered: Map<string, (...commandArguments: unknown[]) => unknown>;
  channelLines: string[];
}

function surroundings(options: {
  otherRuns: boolean;
  logLevel?: unknown;
  missing?: readonly ProposalName[];
}): {
  inputs: ActivationInputs;
  seen: Seen;
} {
  const seen: Seen = {
    events: [],
    registered: new Map(),
    channelLines: [],
  };
  const channel: RevealableChannel = {
    appendLine: text => {
      seen.channelLines.push(text);
    },
    show: () => {
      seen.events.push('channel shown');
    },
    dispose: () => {
      seen.events.push('channel disposed');
    },
  };
  const standDown: StandDownHost = {
    isRunning: () => options.otherRuns,
    setContext: (contextKey, value) => {
      seen.events.push(`context ${contextKey}=${String(value)}`);
      return Promise.resolve();
    },
    showWarning: (text, button) => {
      seen.events.push(`warning ${text} / ${button}`);
      return Promise.resolve(undefined);
    },
    revealExtension: () => Promise.resolve(),
  };
  const inputs: ActivationInputs = {
    table: TABLE,
    extension: {
      id: 'remote-oss.remote-ssh',
      name: 'Remote - SSH',
      version: '0.1.0',
      pack: ['remote-oss.remote-ssh-edit'],
    },
    links: () => {
      seen.events.push('links read');
      return {
        documentation: 'https://example.invalid/docs',
        getStarted: 'https://example.invalid/start',
        feedback: 'https://example.invalid/feedback',
      };
    },
    environment: {
      editorVersion: '1.139.1',
      platform: 'linux',
      architecture: 'x64',
    },
    standDownTexts: {warning: 'Another one runs', button: 'Show it'},
    standDown,
    commands: {
      registerCommand: (commandId, callback) => {
        seen.events.push(`register ${commandId}`);
        seen.registered.set(commandId, callback);
        return {
          dispose: () => {
            seen.events.push(`unregister ${commandId}`);
          },
        };
      },
      showOutOfContext: () => undefined,
    },
    settings: {
      inspectSetting: (): SettingInspection =>
        options.logLevel === undefined ? {} : {globalValue: options.logLevel},
    },
    openConfigFile: {
      execute: () => {
        seen.events.push('open config file');
      },
    },
    help: {
      openExternal: address => {
        seen.events.push(`external ${address}`);
        return Promise.resolve();
      },
      openSettings: () => Promise.resolve(),
      openIssueReporter: () => Promise.resolve(),
    },
    channels: {createOutputChannel: () => channel},
    clock: () => new Date(2026, 9, 8, 0, 0, 0, 0).getTime(),
    gate: () =>
      recordingSetupPorts(
        {
          extensionId: 'remote-oss.remote-ssh',
          missing: options.missing ?? [],
          probed: ['resolvers', 'tunnels'],
        },
        seen.events,
      ),
  };
  return {inputs, seen};
}

describe('the activation', () => {
  it('stands down when the other extension runs: the key is set, one warning shown, nothing registered or opened', async () => {
    const {inputs, seen} = surroundings({otherRuns: true});
    const result = await activateRemoteSsh(inputs);
    deepStrictEqual(
      [result.kind, seen.events, seen.channelLines],
      [
        'standing',
        [
          'context opensshremotes.standingDown=true',
          'warning Another one runs / Show it',
        ],
        [],
      ],
    );
  });

  it('serves when it does not run: the key is cleared first, the help addresses are read, then the seven commands are registered', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    const result = await activateRemoteSsh(inputs);
    deepStrictEqual(
      [result.kind, seen.events],
      [
        'serving',
        [
          'context opensshremotes.standingDown=false',
          'probe',
          'links read',
          'register opensshremotes.showLog',
          'register opensshremotes.getHelp',
          'register opensshremotes.getStarted',
          'register opensshremotes.provideFeedback',
          'register opensshremotes.settings',
          'register opensshremotes.reportIssue',
          'register opensshremotes.openConfigFile',
        ],
      ],
    );
  });

  it('probes the gate after the guard and before anything is registered', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    await activateRemoteSsh(inputs);
    deepStrictEqual(seen.events.slice(0, 3), [
      'context opensshremotes.standingDown=false',
      'probe',
      'links read',
    ]);
  });

  it('does not probe the gate when it stands down', async () => {
    const {inputs, seen} = surroundings({otherRuns: true});
    await activateRemoteSsh(inputs);
    deepStrictEqual(seen.events.includes('probe'), false);
  });

  it('serves the commands and tells the user once when a proposal is missing', async () => {
    const {inputs, seen} = surroundings({
      otherRuns: false,
      missing: ['resolvers'],
    });
    const result = await activateRemoteSsh(inputs);
    if (result.kind === 'serving') {
      await result.setup;
    }
    deepStrictEqual(
      [
        result.kind,
        seen.events.filter(event => ['claim', 'notice'].includes(event)),
        seen.registered.size,
        seen.channelLines.at(-1),
      ],
      [
        'serving',
        ['claim', 'notice'],
        7,
        '[00:00:00.000] Missing proposed APIs: resolvers',
      ],
    );
  });

  it('says which proposals the probe found granted and missing', async () => {
    const {inputs} = surroundings({otherRuns: false, missing: ['resolvers']});
    const result = await activateRemoteSsh(inputs);
    deepStrictEqual(result.kind === 'serving' ? result.proposals : undefined, {
      granted: ['tunnels'],
      missing: ['resolvers'],
    });
  });

  it('logs no line about proposals when none is missing', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    await activateRemoteSsh(inputs);
    deepStrictEqual(
      seen.channelLines.some(line => line.includes('Missing proposed')),
      false,
    );
  });

  it('serves with one failure line and its commands when the gate cannot find the data folder', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    const lacking: ActivationInputs = {
      ...inputs,
      gate: logFailure => ({
        ...recordingSetupPorts(
          {extensionId: 'remote-oss.remote-ssh'},
          seen.events,
        ),
        argvEnabled: () => {
          logFailure('the runtime arguments cannot be located');
          return Promise.resolve([]);
        },
      }),
    };
    const result = await activateRemoteSsh(lacking);
    deepStrictEqual(
      [
        result.kind,
        seen.channelLines.filter(line => line.includes('cannot be located'))
          .length,
        seen.registered.size,
      ],
      ['serving', 1, 7],
    );
  });

  it('logs a failure of the setup into the channel', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    const failing: ActivationInputs = {
      ...inputs,
      gate: logFailure => {
        logFailure('the notice broke');
        return recordingSetupPorts(
          {extensionId: 'remote-oss.remote-ssh'},
          seen.events,
        );
      },
    };
    await activateRemoteSsh(failing);
    deepStrictEqual(
      seen.channelLines.includes('[00:00:00.000] the notice broke'),
      true,
    );
  });

  it('closes the log channel and registers nothing when the probe fails', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    const failing: ActivationInputs = {
      ...inputs,
      gate: () => ({
        ...recordingSetupPorts(
          {extensionId: 'remote-oss.remote-ssh'},
          seen.events,
        ),
        probe: () => Promise.reject(new Error('the editor failed')),
      }),
    };
    await activateRemoteSsh(failing).catch(() => undefined);
    deepStrictEqual(
      [seen.events.includes('channel disposed'), seen.registered.size],
      [true, 0],
    );
  });

  it('opens the log channel before any command is registered', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    await activateRemoteSsh(inputs);
    deepStrictEqual(seen.channelLines, [
      '[00:00:00.000] Log level: debug',
      '[00:00:00.000] Editor version: 1.139.1',
      '[00:00:00.000] Remote - SSH 0.1.0',
      '[00:00:00.000] Client: linux x64',
    ]);
  });

  it('logs at the level the user setting names', async () => {
    const {inputs, seen} = surroundings({otherRuns: false, logLevel: 'trace'});
    await activateRemoteSsh(inputs);
    deepStrictEqual(seen.channelLines[0], '[00:00:00.000] Log level: trace');
  });

  it('Show Log reveals the channel', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    await activateRemoteSsh(inputs);
    seen.registered.get('opensshremotes.showLog')?.();
    deepStrictEqual(seen.events.at(-1), 'channel shown');
  });

  it("F-2304: the serving result reveals the channel, as the connect's details link needs", async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    const result = await activateRemoteSsh(inputs);
    if (result.kind === 'serving') {
      result.revealLog();
    }
    deepStrictEqual(seen.events.at(-1), 'channel shown');
  });

  it('serves the help commands over the editor', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    await activateRemoteSsh(inputs);
    seen.registered.get('opensshremotes.getHelp')?.();
    deepStrictEqual(
      seen.events.at(-1),
      'external https://example.invalid/docs',
    );
  });

  it('undoes the commands and closes the channel when it is disposed', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    const result = await activateRemoteSsh(inputs);
    seen.events.length = 0;
    if (result.kind === 'serving') {
      result.dispose();
    }
    deepStrictEqual(seen.events, [
      'unregister opensshremotes.showLog',
      'unregister opensshremotes.getHelp',
      'unregister opensshremotes.getStarted',
      'unregister opensshremotes.provideFeedback',
      'unregister opensshremotes.settings',
      'unregister opensshremotes.reportIssue',
      'unregister opensshremotes.openConfigFile',
      'channel disposed',
    ]);
  });

  it('reads the help addresses only when it serves', async () => {
    const stands = surroundings({otherRuns: true});
    await activateRemoteSsh(stands.inputs);
    const serves = surroundings({otherRuns: false});
    await activateRemoteSsh(serves.inputs);
    deepStrictEqual(
      [
        stands.seen.events.includes('links read'),
        serves.seen.events.includes('links read'),
      ],
      [false, true],
    );
  });

  it('serves the generated table of the manifest, which holds more commands than it serves, and registers seven', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    await activateRemoteSsh({
      ...inputs,
      table: {commands, settings, standDown},
    });
    deepStrictEqual([...seen.registered.keys()].sort(), [
      'opensshremotes.getHelp',
      'opensshremotes.getStarted',
      'opensshremotes.openConfigFile',
      'opensshremotes.provideFeedback',
      'opensshremotes.reportIssue',
      'opensshremotes.settings',
      'opensshremotes.showLog',
    ]);
  });

  it('closes the log channel and registers nothing more when a registration throws', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    let registrations = 0;
    const failing: ActivationInputs = {
      ...inputs,
      commands: {
        ...inputs.commands,
        registerCommand: (commandId, callback) => {
          registrations += 1;
          if (registrations === 3) {
            throw new Error('the editor refused');
          }
          return inputs.commands.registerCommand(commandId, callback);
        },
      },
    };
    await activateRemoteSsh(failing).catch(() => undefined);
    deepStrictEqual(seen.events.includes('channel disposed'), true);
  });
});
