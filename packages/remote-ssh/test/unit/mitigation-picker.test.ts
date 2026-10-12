import {deepStrictEqual} from 'node:assert';
import type {Failed} from 'lib-authority';
import type {
  FailureActions,
  FailureDialogPort,
} from '../../src/surfaces/failure-presenter.ts';
import {failurePresenterOf} from '../../src/surfaces/failure-presenter.ts';
import {
  moreActionsOf,
  mitigationPickOf,
  type MitigationAction,
  type MitigationActions,
  type MitigationPick,
  type MitigationPickPort,
} from '../../src/surfaces/mitigation-picker.ts';

function same(template: string): string {
  return template;
}

function marked(template: string): string {
  return `<${template}>`;
}

/** A port that records each pick it was given and answers from a script, or throws. */
class FakePort implements MitigationPickPort {
  readonly picks: MitigationPick[] = [];
  private readonly answers: Array<MitigationAction | undefined> = [];
  private readonly failure: Error | undefined;

  constructor(
    answers: Array<MitigationAction | undefined> = [],
    failure?: Error,
  ) {
    this.answers = answers;
    this.failure = failure;
  }

  pick(pick: MitigationPick): Promise<MitigationAction | undefined> {
    this.picks.push(pick);
    if (this.failure !== undefined) {
      return Promise.reject(this.failure);
    }
    return Promise.resolve(this.answers.shift());
  }
}

/** The actions, recording what was run. */
function recordActions(): {
  calls: MitigationAction[];
  actions: MitigationActions;
} {
  const calls: MitigationAction[] = [];
  function make(name: MitigationAction): () => Promise<unknown> {
    return (): Promise<unknown> => {
      calls.push(name);
      return Promise.resolve();
    };
  }
  return {
    calls,
    actions: {
      reloadWindow: make('reloadWindow'),
      openRecent: make('openRecent'),
      openDocumentation: make('openDocumentation'),
      openConfigFile: make('openConfigFile'),
      openSettings: make('openSettings'),
    },
  };
}

function failed(kind: string): Failed {
  return {
    kind,
    retryable: false,
    silent: false,
    userAlreadyNotified: false,
    hints: [],
    diagnostics: [],
  };
}

/** Lets the chain behind a started dialog run. */
async function settle(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

describe('the more actions picker (F-2602)', () => {
  it('F-2602 AC-1: the placeholder is the pick question', () => {
    deepStrictEqual(
      mitigationPickOf(same).placeholder,
      'Pick an action to help resolve the problem.',
    );
  });

  it('F-2602 AC-2: the labels are the five items in order', () => {
    deepStrictEqual(
      mitigationPickOf(same).items.map(item => item.label),
      [
        'Reload Window',
        'Open Recent...',
        'Open Documentation',
        'Open SSH Configuration File',
        'Open Settings',
      ],
    );
  });

  it('F-2602 AC-2: each label carries its action', () => {
    deepStrictEqual(
      mitigationPickOf(same).items.map(item => item.action),
      [
        'reloadWindow',
        'openRecent',
        'openDocumentation',
        'openConfigFile',
        'openSettings',
      ],
    );
  });

  it('R-29: the placeholder and every label go through the translator', () => {
    deepStrictEqual(mitigationPickOf(marked), {
      placeholder: '<Pick an action to help resolve the problem.>',
      items: [
        {label: '<Reload Window>', action: 'reloadWindow'},
        {label: '<Open Recent...>', action: 'openRecent'},
        {label: '<Open Documentation>', action: 'openDocumentation'},
        {label: '<Open SSH Configuration File>', action: 'openConfigFile'},
        {label: '<Open Settings>', action: 'openSettings'},
      ],
    });
  });

  it('F-2602 5.0 step 4: the reloadWindow item runs that action once', async () => {
    const port = new FakePort(['reloadWindow']);
    const {calls, actions} = recordActions();
    await moreActionsOf(port, actions, same)();
    deepStrictEqual(calls, ['reloadWindow']);
  });

  it('F-2602 5.0 step 4: the openRecent item runs that action once', async () => {
    const port = new FakePort(['openRecent']);
    const {calls, actions} = recordActions();
    await moreActionsOf(port, actions, same)();
    deepStrictEqual(calls, ['openRecent']);
  });

  it('F-2602 5.0 step 4: the openDocumentation item runs that action once', async () => {
    const port = new FakePort(['openDocumentation']);
    const {calls, actions} = recordActions();
    await moreActionsOf(port, actions, same)();
    deepStrictEqual(calls, ['openDocumentation']);
  });

  it('F-2602 5.0 step 4: the openConfigFile item runs that action once', async () => {
    const port = new FakePort(['openConfigFile']);
    const {calls, actions} = recordActions();
    await moreActionsOf(port, actions, same)();
    deepStrictEqual(calls, ['openConfigFile']);
  });

  it('F-2602 5.0 step 4: the openSettings item runs that action once', async () => {
    const port = new FakePort(['openSettings']);
    const {calls, actions} = recordActions();
    await moreActionsOf(port, actions, same)();
    deepStrictEqual(calls, ['openSettings']);
  });

  it('F-2602 AC-11: a closed pick runs no action', async () => {
    const port = new FakePort([undefined]);
    const {calls, actions} = recordActions();
    await moreActionsOf(port, actions, same)();
    deepStrictEqual(calls, []);
  });

  it('F-2602 BR-4: two calls give the port two equal picks, not one object', async () => {
    const port = new FakePort(['reloadWindow', 'openRecent']);
    const {actions} = recordActions();
    const moreActions = moreActionsOf(port, actions, same);
    await moreActions();
    await moreActions();
    deepStrictEqual(
      [
        JSON.stringify(port.picks[0]) === JSON.stringify(port.picks[1]),
        port.picks[0] === port.picks[1],
      ],
      [true, false],
    );
  });

  it('F-2602 BR-2: the pick is the same for failures of different kinds', async () => {
    const port = new FakePort(['reloadWindow', 'openRecent']);
    const {actions: itemActions} = recordActions();
    const dialog: FailureDialogPort = {
      showError: () => {
        return Promise.resolve('More Actions...');
      },
    };
    const failureActions: FailureActions = {
      reload: () => {
        return Promise.resolve();
      },
      closeRemote: () => {
        return Promise.resolve();
      },
      moreActions: moreActionsOf(port, itemActions, same),
      openSetting: () => {
        return Promise.resolve();
      },
    };
    const presenter = failurePresenterOf(dialog, failureActions, same, {
      alias: () => 'box',
      applicationName: 'VSCodium',
      displayName: 'Remote - SSH',
    });
    await presenter.present(failed('unknown'));
    await settle();
    await presenter.present(failed('timeout'));
    await settle();
    deepStrictEqual([port.picks[0], port.picks.length], [port.picks[1], 2]);
  });

  it('contracts: a port that rejects gives its error to the caller', async () => {
    const failure = new Error('the pick went away');
    const port = new FakePort([], failure);
    const {actions} = recordActions();
    const attempt = moreActionsOf(port, actions, same)();
    const reason = await attempt.catch((error: unknown) => error);
    deepStrictEqual(reason === failure, true);
  });
});
