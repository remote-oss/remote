import {deepStrictEqual} from 'node:assert';
import type {CommandEntry, CommandHandler, CommandHost} from 'lib-identifiers';
import {createLogger, type LogLine} from 'lib-log';
import type {StandDownHost} from 'lib-standdown';
import {
  activateWsl,
  type PresenceResult,
  type WslActivationInputs,
} from '../../src/activation.ts';
import {presenceBoundMilliseconds} from '../../src/defaults.ts';

const OTHER = 'other.wsl';
const STANDING_KEY = 'wsl.standingDown';
const NO_DISTROS_KEY = 'wsl.noWSLDistrosInstalled';

/** A context key write: the key and its value. */
type KeyWrite = [string, unknown];

const COMMANDS = {
  connect: {
    id: 'remote-wsl.connect',
    title: '%connect%',
    palette: true,
    policy: 'silent',
  },
  showLog: {
    id: 'remote-wsl.showLog',
    title: '%showLog%',
    palette: true,
    policy: 'silent',
  },
} as const satisfies Readonly<Record<string, CommandEntry>>;

/** A window whose other extension runs or not, and what activation did in it. */
interface Scene {
  contexts: Array<[string, unknown]>;
  warnings: string[];
  registered: string[];
  lines: string[];
  timers: Array<{milliseconds: number; fire: () => void; stopped: boolean}>;
  inputs: WslActivationInputs<typeof COMMANDS>;
}

function sceneOf(
  otherRunning: boolean,
  presence?: (cancellation: AbortSignal) => PromiseLike<PresenceResult>,
): Scene {
  const scene = {
    contexts: [],
    warnings: [],
    registered: [],
    lines: [],
    timers: [],
  } as unknown as Scene;
  const standDown: StandDownHost = {
    isRunning: extensionId => otherRunning && extensionId === OTHER,
    setContext: (contextKey, value) => {
      scene.contexts.push([contextKey, value]);
      return Promise.resolve();
    },
    showWarning: text => {
      scene.warnings.push(text);
      return Promise.resolve(undefined);
    },
    revealExtension: () => Promise.resolve(),
  };
  const commands: CommandHost = {
    registerCommand: commandId => {
      scene.registered.push(commandId);
      return {dispose: () => undefined};
    },
    showOutOfContext: () => undefined,
  };
  const quiet: CommandHandler = {execute: () => undefined};
  scene.inputs = {
    table: {
      commands: COMMANDS,
      runtimeCommandIds: ['remote-wsl.newWindow'],
      standDown: {standsDownFor: OTHER, contextKey: STANDING_KEY},
      noDistrosKey: {id: NO_DISTROS_KEY, setter: 'extension'},
    },
    standDownTexts: {warning: 'stays inactive', button: 'Show Other Extension'},
    standDown,
    commands,
    contextKeys: {
      setContext: (contextKey, value) => {
        scene.contexts.push([contextKey, value]);
        return Promise.resolve();
      },
    },
    handlers: {connect: quiet, showLog: quiet},
    runtimeHandler: () => quiet,
    logger: createLogger(
      {
        write: (line: LogLine) => {
          scene.lines.push(line.message);
        },
      },
      {minimumLevel: () => 'trace'},
    ),
    ...(presence === undefined ? {} : {presence}),
    presenceBoundMilliseconds,
    startTimer: (milliseconds, callback) => {
      const timer = {milliseconds, fire: callback, stopped: false};
      scene.timers.push(timer);
      return () => {
        timer.stopped = true;
      };
    },
  };
  return scene;
}

describe('the activation of WSL (wsl.package)', () => {
  it('stands down first: with the other extension running it registers nothing and reads no presence', async () => {
    let asked = 0;
    const scene = sceneOf(true, () => {
      asked += 1;
      return Promise.resolve({kind: 'present'});
    });
    const outcome = await activateWsl(scene.inputs);
    deepStrictEqual(
      [outcome.kind, scene.registered, asked, scene.contexts],
      ['standing', [], 0, [[STANDING_KEY, true]]],
    );
  });

  it('serves: every command of the table and every runtime command is registered, and a window without presence reads none', async () => {
    const scene = sceneOf(false);
    const outcome = await activateWsl(scene.inputs);
    if (outcome.kind === 'serving') {
      await outcome.presenceSettled;
      outcome.dispose();
    }
    deepStrictEqual(
      [outcome.kind, scene.registered, scene.timers.length, scene.contexts],
      [
        'serving',
        ['remote-wsl.connect', 'remote-wsl.showLog', 'remote-wsl.newWindow'],
        0,
        [[STANDING_KEY, false]],
      ],
    );
  });

  it('sets the distro key true for no distro, and false for WSL with distros and for no WSL, stopping the bound', async () => {
    const results: KeyWrite[][] = [];
    for (const kind of ['noDistro', 'present', 'absent'] as const) {
      const scene = sceneOf(false, () => Promise.resolve({kind}));
      const outcome = await activateWsl(scene.inputs);
      if (outcome.kind === 'serving') {
        await outcome.presenceSettled;
      }
      results.push([
        ...scene.contexts.filter(([key]) => key === NO_DISTROS_KEY),
        ['stopped', scene.timers[0]?.stopped],
      ]);
    }
    deepStrictEqual(results, [
      [
        [NO_DISTROS_KEY, true],
        ['stopped', true],
      ],
      [
        [NO_DISTROS_KEY, false],
        ['stopped', true],
      ],
      [
        [NO_DISTROS_KEY, false],
        ['stopped', true],
      ],
    ]);
  });

  it('does not wait for the presence: a check that never answers still lets activation resolve, and the bound then cancels it with one line and no key', async () => {
    let cancellation: AbortSignal | undefined;
    let answer: ((result: PresenceResult) => void) | undefined;
    const scene = sceneOf(false, signal => {
      cancellation = signal;
      return new Promise(resolve => {
        answer = resolve;
      });
    });
    const outcome = await activateWsl(scene.inputs);
    scene.timers[0]?.fire();
    if (outcome.kind === 'serving') {
      await outcome.presenceSettled;
    }
    answer?.({kind: 'noDistro'});
    await new Promise(resolve => setImmediate(resolve));
    deepStrictEqual(
      {
        kind: outcome.kind,
        bound: scene.timers[0]?.milliseconds,
        aborted: cancellation?.aborted,
        lines: scene.lines,
        keys: scene.contexts.filter(([key]) => key === NO_DISTROS_KEY),
      },
      {
        kind: 'serving',
        bound: presenceBoundMilliseconds,
        aborted: true,
        lines: [
          `the WSL presence check gave no answer within ${String(presenceBoundMilliseconds)} ms`,
        ],
        keys: [],
      },
    );
  });

  it('a presence check that fails sets no key and stops the bound', async () => {
    const scene = sceneOf(false, () => Promise.reject(new Error('no wsl.exe')));
    const outcome = await activateWsl(scene.inputs);
    if (outcome.kind === 'serving') {
      await outcome.presenceSettled;
    }
    deepStrictEqual(
      [
        scene.contexts.filter(([key]) => key === NO_DISTROS_KEY),
        scene.timers[0]?.stopped,
        scene.lines,
      ],
      [[], true, []],
    );
  });
});
