import {deepStrictEqual} from 'node:assert';
import type {ProposalName} from 'lib-authority';
import {createLogger} from 'lib-log';
import {recordingSetupPorts} from 'lib-authority/testing/recording-setup-ports';
import type {CommandEntry} from 'lib-identifiers';
import type {StandDownHost} from 'lib-standdown';
import type {PreflightDependencies} from '../../src/engine/preflight.ts';
import {
  activateContainers,
  type ContainersActivationInputs,
  type ContainersTable,
} from '../../src/activation.ts';

function command(name: string): CommandEntry {
  return {
    id: `remote-containers.${name}`,
    title: `%commands.${name}.title%`,
    palette: true,
    policy: 'silent',
  };
}

/** A stand-in for the surroundings of the Docker checks, made once per serving window. */
function preflightOf(label: string): PreflightDependencies {
  return {
    engineFor: () => {
      throw new Error(label);
    },
    dockerPath: () => label,
    dialogs: {
      showError: () => Promise.resolve(undefined),
      openExternal: () => Promise.resolve(undefined),
      revealLog: () => undefined,
    },
    translate: template => template,
    setTimer: () => () => undefined,
    clock: () => 0,
    logger: createLogger(undefined, {minimumLevel: () => 'info'}),
    searchPath: () => '',
  };
}

const OTHER = 'ms-vscode-remote.remote-containers';

const TABLE = {
  commands: {alpha: command('alpha'), beta: command('beta')},
  standDown: {
    standsDownFor: OTHER,
    contextKey: 'remote-containers:standingDown',
  },
} satisfies ContainersTable<Record<string, CommandEntry>>;

const BANNER = {
  displayName: 'Dev Containers',
  extensionVersion: '0.1.0',
  editorName: 'VSCodium',
  editorVersion: '1.139.0',
  editorCommit: 'abc',
};

/** What the fake surroundings saw, in the order it happened. */
interface Seen {
  events: string[];
  channelLines: string[];
  revealed: string[];
}

interface Options {
  otherRuns: boolean;
  missing?: readonly ProposalName[];
  gateThrows?: boolean;
  registerThrows?: boolean;
  warningAnswer?: string;
  /** Whether the user dismissed the setup notice before. */
  dismissed?: boolean;
}

function surroundings(options: Options): {
  inputs: ContainersActivationInputs<typeof TABLE.commands>;
  seen: Seen;
} {
  const seen: Seen = {events: [], channelLines: [], revealed: []};
  function record(event: string): void {
    seen.events.push(event);
  }
  const standDown: StandDownHost = {
    isRunning: () => options.otherRuns,
    setContext: (contextKey, value) => {
      record(`context ${contextKey}=${String(value)}`);
      return Promise.resolve();
    },
    showWarning: (text, button) => {
      record(`warning ${text} / ${button}`);
      return Promise.resolve(options.warningAnswer);
    },
    revealExtension: extensionId => {
      seen.revealed.push(extensionId);
      return Promise.resolve();
    },
  };
  const inputs: ContainersActivationInputs<typeof TABLE.commands> = {
    table: TABLE,
    standDownTexts: {warning: 'Another one runs', button: 'Show it'},
    standDown,
    commands: {
      registerCommand: commandId => {
        if (options.registerThrows === true) {
          throw new Error('cannot register');
        }
        seen.events.push(`register ${commandId}`);
        return {
          dispose: () => {
            seen.events.push(`unregister ${commandId}`);
          },
        };
      },
      showOutOfContext: () => undefined,
    },
    channels: {
      createOutputChannel: name => {
        seen.events.push(`channel ${name}`);
        return {
          appendLine: text => {
            seen.channelLines.push(text);
          },
          dispose: () => {
            seen.events.push('channel disposed');
          },
        };
      },
    },
    clock: () => new Date(2026, 9, 14, 0, 0, 0, 0).getTime(),
    banner: BANNER,
    preflight: () => {
      seen.events.push('preflight');
      return preflightOf('window');
    },
    gate: logFailure => {
      seen.events.push('gate');
      if (options.gateThrows === true) {
        throw new Error('no editor');
      }
      logFailure('a failure of the setup');
      const ports = recordingSetupPorts(
        {
          extensionId: 'remote-oss.remote-containers',
          missing: options.missing ?? [],
          probed: ['resolvers', 'tunnels'],
        },
        seen.events,
      );
      return {
        ...ports,
        flags: {...ports.flags, dismissed: () => options.dismissed === true},
      };
    },
    handlers: () => {
      seen.events.push('handlers');
      return {
        alpha: {execute: () => undefined},
        beta: {execute: () => undefined},
      };
    },
  };
  return {inputs, seen};
}

describe('the activation', () => {
  it('F-0101.BR-10: the other extension runs: the key is set, one warning is shown, nothing is opened or registered', async () => {
    const {inputs, seen} = surroundings({otherRuns: true});
    const result = await activateContainers(inputs);
    deepStrictEqual(
      [result.kind, seen.events, seen.channelLines],
      [
        'standing',
        [
          'context remote-containers:standingDown=true',
          'warning Another one runs / Show it',
        ],
        [],
      ],
    );
  });

  it('F-0101.BR-10: the button of the warning reveals the other extension', async () => {
    const {inputs, seen} = surroundings({
      otherRuns: true,
      warningAnswer: 'Show it',
    });
    await activateContainers(inputs);
    deepStrictEqual(seen.revealed, [OTHER]);
  });

  it('F-0101.BR-10: the other extension does not run: the key is cleared, then the channel, the setup and the commands, in that order', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    const result = await activateContainers(inputs);
    deepStrictEqual(
      [result.kind, seen.events],
      [
        'serving',
        [
          'context remote-containers:standingDown=false',
          'channel Dev Containers',
          'gate',
          'probe',
          'preflight',
          'handlers',
          'register remote-containers.alpha',
          'register remote-containers.beta',
        ],
      ],
    );
  });

  it('containers-03: the served window carries the surroundings of the Docker checks, made once', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    const result = await activateContainers(inputs);
    deepStrictEqual(
      [
        result.kind === 'serving'
          ? result.served.preflight.dockerPath()
          : undefined,
        seen.events.filter(event => event === 'preflight'),
      ],
      ['window', ['preflight']],
    );
  });

  it('F-0101.BR-4: the log opens with the version line, then the two lines of the initialization, at the info level', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    await activateContainers(inputs);
    deepStrictEqual(
      seen.channelLines.slice(0, 3).map(line => line.replace(/^\S+ /, '')),
      [
        '[info] Dev Containers 0.1.0 in VSCodium 1.139.0 (abc).',
        '[info] Initializing configuration support...',
        '[info] Internal initialization of dev container support package...',
      ],
    );
  });

  it('F-0101.BR-9: a missing resolvers proposal is logged, named in the window and leaves both commands registered', async () => {
    const {inputs, seen} = surroundings({
      otherRuns: false,
      missing: ['resolvers'],
    });
    const result = await activateContainers(inputs);
    deepStrictEqual(
      [
        seen.channelLines.some(line =>
          line.endsWith('Missing proposed APIs: resolvers'),
        ),
        result.kind === 'serving' ? result.served.missing : undefined,
        seen.events.filter(event => event.startsWith('register ')).length,
      ],
      [true, ['resolvers'], 2],
    );
  });

  it('F-0101.BR-9: a failure the setup reports is written to the log as an error', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    await activateContainers(inputs);
    deepStrictEqual(
      seen.channelLines.some(line =>
        line.endsWith('[error] a failure of the setup'),
      ),
      true,
    );
  });

  it('F-0101.BR-9: nothing missing writes no line about proposed APIs', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    await activateContainers(inputs);
    deepStrictEqual(
      seen.channelLines.filter(line => line.includes('Missing proposed APIs')),
      [],
    );
  });

  it('F-0101.BR-9: setupAgain probes again', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    const result = await activateContainers(inputs);
    if (result.kind === 'serving') {
      await result.setup;
      seen.events.length = 0;
      await result.served.setupAgain();
    }
    deepStrictEqual(seen.events, ['probe']);
  });

  it('F-0101.BR-9: at activation a dismissed notice stays silent', async () => {
    const {inputs, seen} = surroundings({
      otherRuns: false,
      missing: ['resolvers'],
      dismissed: true,
    });
    const result = await activateContainers(inputs);
    if (result.kind === 'serving') {
      await result.setup;
    }
    deepStrictEqual(
      seen.events.filter(event => event === 'claim' || event === 'notice'),
      [],
    );
  });

  it('F-0101.BR-9: setupAgain, after a use that needed a proposal failed, tells the user though the notice was dismissed', async () => {
    const {inputs, seen} = surroundings({
      otherRuns: false,
      missing: ['resolvers'],
      dismissed: true,
    });
    const result = await activateContainers(inputs);
    seen.events.length = 0;
    if (result.kind === 'serving') {
      await (
        await result.served.setupAgain()
      ).interaction;
    }
    deepStrictEqual(
      seen.events.filter(event => event === 'claim' || event === 'notice'),
      ['claim', 'notice'],
    );
  });

  it('F-0101.BR-9: the activation tells the user about a missing proposal once', async () => {
    const {inputs, seen} = surroundings({
      otherRuns: false,
      missing: ['resolvers'],
    });
    const result = await activateContainers(inputs);
    if (result.kind === 'serving') {
      await result.setup;
    }
    deepStrictEqual(
      seen.events.filter(event => event === 'claim' || event === 'notice'),
      ['claim', 'notice'],
    );
  });

  it('F-0101.BR-9: a gate that throws fails the activation, closes the channel and registers nothing', async () => {
    const {inputs, seen} = surroundings({otherRuns: false, gateThrows: true});
    const failure = await activateContainers(inputs).catch(
      (caught: unknown) => (caught as Error).message,
    );
    deepStrictEqual(
      [failure, seen.events.filter(event => event.startsWith('register'))],
      ['no editor', []],
    );
  });

  it('F-0101.BR-9: a gate that throws closes the channel', async () => {
    const {inputs, seen} = surroundings({otherRuns: false, gateThrows: true});
    await activateContainers(inputs).catch(() => undefined);
    deepStrictEqual(seen.events.at(-1), 'channel disposed');
  });

  it('F-0101.BR-10: a registration that throws fails the activation and closes the channel', async () => {
    const {inputs, seen} = surroundings({
      otherRuns: false,
      registerThrows: true,
    });
    const failure = await activateContainers(inputs).catch(
      (caught: unknown) => (caught as Error).message,
    );
    deepStrictEqual(
      [failure, seen.events.at(-1)],
      ['cannot register', 'channel disposed'],
    );
  });

  it('F-0101.BR-2: activation is silent: no notice of its own is shown', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    await activateContainers(inputs);
    deepStrictEqual(
      seen.events.filter(event => event.startsWith('warning')),
      [],
    );
  });

  it('containers-01: the served window gives the handlers a logger that writes to the channel', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    await activateContainers({
      ...inputs,
      handlers: served => {
        served.logger.info('from a handler');
        return inputs.handlers(served);
      },
    });
    deepStrictEqual(
      seen.channelLines.at(-1)?.endsWith('[info] from a handler'),
      true,
    );
  });

  it('containers-01: disposing the result unregisters every command once, then closes the channel once', async () => {
    const {inputs, seen} = surroundings({otherRuns: false});
    const result = await activateContainers(inputs);
    seen.events.length = 0;
    if (result.kind === 'serving') {
      result.dispose();
    }
    deepStrictEqual(seen.events, [
      'unregister remote-containers.alpha',
      'unregister remote-containers.beta',
      'channel disposed',
    ]);
  });
});
