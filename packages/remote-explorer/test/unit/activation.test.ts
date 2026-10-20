import {deepStrictEqual} from 'node:assert';
import type {CommandHost} from 'lib-identifiers';
import type {StandDownHost} from 'lib-standdown';
import {
  activateExplorer,
  type ExplorerActivationInputs,
  silentHandlers,
} from '../../src/activation.ts';
import {commands, standDown} from '../../src/identifiers.generated.ts';

const WARNING = 'Another Remote Explorer runs';
const BUTTON = 'Show it';

/** The editor's side of the stand-down guard, writing what happens to a list. */
class RecordedStandDown implements StandDownHost {
  private readonly events: string[];
  private readonly other: boolean;
  private readonly chooses: boolean;

  constructor(events: string[], other: boolean, chooses: boolean) {
    this.events = events;
    this.other = other;
    this.chooses = chooses;
  }

  isRunning(): boolean {
    return this.other;
  }

  setContext(contextKey: string, value: boolean): Promise<void> {
    this.events.push(`context ${contextKey}=${String(value)}`);
    return Promise.resolve();
  }

  showWarning(text: string, button: string): Promise<string | undefined> {
    this.events.push(`warning ${text} ${button}`);
    return Promise.resolve(this.chooses ? button : undefined);
  }

  revealExtension(extensionId: string): Promise<void> {
    this.events.push(`reveal ${extensionId}`);
    return Promise.resolve();
  }
}

/** The editor's command registry, writing what happens to a list and keeping each callback. */
function recordedCommands(
  events: string[],
  callbacks: Array<(...commandArguments: unknown[]) => unknown>,
): CommandHost {
  return {
    registerCommand: (commandId, callback) => {
      events.push(`register ${commandId}`);
      callbacks.push(callback);
      return {
        dispose: () => {
          events.push(`unregister ${commandId}`);
        },
      };
    },
    showOutOfContext: () => {
      events.push('out of context');
    },
  };
}

interface Scenario {
  inputs: ExplorerActivationInputs<typeof commands>;
  events: string[];
  callbacks: Array<(...commandArguments: unknown[]) => unknown>;
}

function scenarioOf(options: {
  other: boolean;
  chooses?: boolean;
  setup?: () => Promise<unknown>;
}): Scenario {
  const events: string[] = [];
  const callbacks: Scenario['callbacks'] = [];
  return {
    events,
    callbacks,
    inputs: {
      table: {commands, standDown},
      standDownTexts: {warning: WARNING, button: BUTTON},
      standDown: new RecordedStandDown(
        events,
        options.other,
        options.chooses === true,
      ),
      commands: recordedCommands(events, callbacks),
      handlers: silentHandlers(commands),
      setup: () => {
        events.push('setup');
        return options.setup?.() ?? Promise.resolve();
      },
    },
  };
}

/** The ids of the generated table, in table order. */
const TABLE_IDS = Object.values(commands).map(entry => entry.id);

describe('the activation of Remote Explorer (card explorer-03b)', () => {
  it('F-5001.BR-10: where the other runs the package stands down, sets its key, warns, and sets up and registers nothing', async () => {
    const scenario = scenarioOf({other: true});
    const result = await activateExplorer(scenario.inputs);
    deepStrictEqual(
      [result, scenario.events],
      [
        {kind: 'standing'},
        [
          'context remote-explorer.standingDown=true',
          `warning ${WARNING} ${BUTTON}`,
        ],
      ],
    );
  });

  it('F-5001.6.6: the warning button opens the other extension once', async () => {
    const scenario = scenarioOf({other: true, chooses: true});
    await activateExplorer(scenario.inputs);
    await Promise.resolve();
    deepStrictEqual(
      scenario.events.filter(event => event.startsWith('reveal ')),
      ['reveal ms-vscode.remote-explorer'],
    );
  });

  it('F-5001.AC-21, AC-22, F-5901.AC-5: F-5001.BR-11: where the other does not run the package clears its key, sets up, then registers each command in table order', async () => {
    const scenario = scenarioOf({other: false});
    const result = await activateExplorer(scenario.inputs);
    deepStrictEqual(
      [result.kind, scenario.events],
      [
        'serving',
        [
          'context remote-explorer.standingDown=false',
          'setup',
          ...TABLE_IDS.map(commandId => `register ${commandId}`),
        ],
      ],
    );
  });

  it('F-5001.BR-10: a setup that fails fails the activation, with nothing registered', async () => {
    const scenario = scenarioOf({
      other: false,
      setup: () => Promise.reject(new Error('probe')),
    });
    const failure = await activateExplorer(scenario.inputs).then(
      () => 'resolved',
      (caught: unknown) => (caught as Error).message,
    );
    deepStrictEqual(
      [failure, scenario.events.filter(event => event.startsWith('register '))],
      ['probe', []],
    );
  });

  it('F-5002.19.7: every registered command does nothing visible and returns nothing, whatever the argument', async () => {
    const scenario = scenarioOf({other: false});
    await activateExplorer(scenario.inputs);
    const before = [...scenario.events];
    const returned = scenario.callbacks.flatMap(callback => [
      callback(),
      callback('bogus-f5002'),
      callback({}),
    ]);
    deepStrictEqual(
      [returned, scenario.events],
      [
        scenario.callbacks.flatMap(() => [undefined, undefined, undefined]),
        before,
      ],
    );
  });

  it('F-5002.19.1: disposing the activation disposes each registration exactly once', async () => {
    const scenario = scenarioOf({other: false});
    const result = await activateExplorer(scenario.inputs);
    if (result.kind === 'serving') {
      result.dispose();
    }
    deepStrictEqual(
      scenario.events.filter(event => event.startsWith('unregister ')),
      TABLE_IDS.map(commandId => `unregister ${commandId}`),
    );
  });

  it('F-5002.19.3: the silent handlers are one per command, and none has an availability check', () => {
    const handlers = silentHandlers(commands);
    deepStrictEqual(
      [
        Object.keys(handlers),
        Object.values(handlers).map(handler => handler.execute()),
        Object.values(handlers).map(handler => 'isAvailable' in handler),
      ],
      [
        Object.keys(commands),
        Object.keys(commands).map(() => undefined),
        Object.keys(commands).map(() => false),
      ],
    );
  });
});
