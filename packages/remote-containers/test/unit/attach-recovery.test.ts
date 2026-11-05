import {deepStrictEqual} from 'node:assert';
import type {Failed} from 'lib-authority';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  attachDialogOf,
  attachPickOf,
} from '../../src/surfaces/attach-dialog.ts';
import {
  type AttachRecoveryPorts,
  attachRecoveryPresenterOf,
} from '../../src/surfaces/attach-recovery.ts';
import {
  attachedNotFound,
  attachedNotRunning,
  attachFailed,
  requirementsNotMet,
} from '../../src/connect/failures.ts';
import {
  CONTAINERS_DOCUMENTATION,
  CONTAINERS_REQUIREMENTS,
} from '../../src/surfaces/recovery-presenter.ts';

function translate(template: string): string {
  return template;
}

function labelsOf(choices: ReadonlyArray<{label: string}>): string[] {
  return choices.map(choice => choice.label);
}

describe('the dialogs of an attach that failed (card containers-163, part A)', () => {
  it('F-0601 AC-11: a container that is not running has S054 with the label’s suffix, and Start Container first', () => {
    const dialog = attachDialogOf(
      attachedNotRunning('alpine:latest', 'web', ' @ ctx'),
      translate,
    );
    deepStrictEqual(
      [dialog.detail, labelsOf(dialog.buttons)],
      [
        'Cannot attach to the container alpine:latest (web) @ ctx, it is not running.',
        ['Start Container', 'Close Remote', 'More Actions...'],
      ],
    );
  });

  it('F-0601 AC-13: a container that no longer exists has S053 with its slashed name, and Choose Container first', () => {
    const dialog = attachDialogOf(attachedNotFound('/web'), translate);
    deepStrictEqual(
      [dialog.detail, labelsOf(dialog.buttons)],
      [
        'Cannot attach to the container with name/id /web, it no longer exists.',
        ['Choose Container', 'Close Remote', 'More Actions...'],
      ],
    );
  });

  it('F-0601 AC-17: a failed set-up has S033 and Retry first', () => {
    const dialog = attachDialogOf(attachFailed(), translate);
    deepStrictEqual(
      [dialog.detail, labelsOf(dialog.buttons)],
      [
        'An error occurred attaching to the container.',
        ['Retry', 'Close Remote', 'More Actions...'],
      ],
    );
  });

  it('F-0503 AC-46 (c163-requirements-dialog): a container that does not meet the server’s requirements has S346 as its message, Learn More first, and the same first item in the picker', () => {
    const failed = requirementsNotMet('no libstdc++');
    const dialog = attachDialogOf(failed, translate);
    deepStrictEqual(
      [
        dialog.message,
        labelsOf(dialog.buttons),
        labelsOf(attachPickOf(failed, translate).items),
      ],
      [
        'The container does not meet all the requirements of the VS Code Server.',
        ['Learn More', 'Close Remote', 'More Actions...'],
        ['Learn More', 'Open Recent...', 'Open Documentation'],
      ],
    );
  });

  it('F-0601 AC-33, AC-35, AC-20: the recovery picker starts with the dialog’s primary action, but with Reload Window and no Retry for a failed set-up', () => {
    deepStrictEqual(
      [
        attachedNotRunning('i', 'n', ''),
        attachedNotFound('/n'),
        attachFailed(),
      ].map(failed => labelsOf(attachPickOf(failed, translate).items)),
      [
        ['Start Container', 'Open Recent...', 'Open Documentation'],
        ['Choose Container', 'Open Recent...', 'Open Documentation'],
        ['Reload Window', 'Open Recent...', 'Open Documentation'],
      ],
    );
  });
});

/** The ports with the choices to give in order, and what the presenter did. */
function sceneOf(options: {
  dialog?: string | undefined;
  picks?: Array<string | undefined>;
}) {
  const done: string[] = [];
  const picks = [...(options.picks ?? [])];
  const ports: AttachRecoveryPorts = {
    showError: (message, detail, buttons) => {
      done.push(`dialog ${buttons.map(button => button.title).join('|')}`);
      return Promise.resolve(options.dialog);
    },
    pick: (placeholder, labels) => {
      done.push(`pick ${labels.join('|')}`);
      return Promise.resolve(picks.shift());
    },
    startContainer: () => {
      done.push('start');
      return Promise.resolve(true);
    },
    chooseContainer: () => {
      done.push('choose');
      return Promise.resolve();
    },
    closeRemote: () => {
      done.push('close');
      return Promise.resolve();
    },
    reloadWindow: () => {
      done.push('reload');
      return Promise.resolve();
    },
    openRecent: () => {
      done.push('recent');
      return Promise.resolve();
    },
    openExternal: address => {
      done.push(`open ${address}`);
      return Promise.resolve();
    },
    later: task => {
      task();
    },
    disconnected: () => {
      done.push('disconnected');
    },
    logger: createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
  };
  return {
    done,
    present: (failed: Failed) =>
      attachRecoveryPresenterOf(ports, translate).present(failed),
  };
}

/** Lets what the presenter scheduled run. */
function settled(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

describe('the presenter of an attach that failed (card containers-163, part A)', () => {
  it('F-0601 AC-12: Start Container starts the container and reloads the window', async () => {
    const scene = sceneOf({dialog: 'Start Container'});
    const outcome = await scene.present(attachedNotRunning('i', 'n', ''));
    deepStrictEqual([outcome, scene.done.slice(1)], ['reload', ['start']]);
  });

  it('F-0601 AC-17: Retry reloads the window with nothing else done', async () => {
    const scene = sceneOf({dialog: 'Retry'});
    deepStrictEqual(
      [await scene.present(attachFailed()), scene.done.slice(1)],
      ['reload', []],
    );
  });

  it('F-0601 AC-14, AC-32: Choose Container reopens the picker, and Close Remote closes the remote, each leaving the window as it is', async () => {
    const chosen = sceneOf({dialog: 'Choose Container'});
    const closed = sceneOf({dialog: 'Close Remote'});
    deepStrictEqual(
      [
        await chosen.present(attachedNotFound('/n')),
        chosen.done.slice(1),
        await closed.present(attachedNotFound('/n')),
        closed.done.slice(1),
      ],
      ['handled', ['choose'], 'handled', ['close']],
    );
  });

  it('F-0601 AC-33, AC-34, AC-35: More Actions... and Escape disconnect and show the picker, and Open Documentation opens the page and shows it again', async () => {
    const scene = sceneOf({
      dialog: 'More Actions...',
      picks: ['Open Documentation', 'Start Container'],
    });
    const outcome = await scene.present(attachedNotRunning('i', 'n', ''));
    await settled();
    await settled();
    deepStrictEqual(
      [outcome, scene.done.slice(1)],
      [
        'handled',
        [
          'disconnected',
          'pick Start Container|Open Recent...|Open Documentation',
          `open ${CONTAINERS_DOCUMENTATION}`,
          'pick Start Container|Open Recent...|Open Documentation',
          'start',
          'reload',
        ],
      ],
    );
  });

  it('F-0601 AC-20: the picker of a failed set-up reloads on Reload Window, opens Recent on Open Recent, and a closed picker does nothing', async () => {
    const reloading = sceneOf({
      dialog: undefined,
      picks: ['Reload Window'],
    });
    const recent = sceneOf({dialog: undefined, picks: ['Open Recent...']});
    const none = sceneOf({dialog: undefined, picks: [undefined]});
    for (const scene of [reloading, recent, none]) {
      await scene.present(attachFailed());
      await settled();
    }
    deepStrictEqual(
      [reloading.done.at(-1), recent.done.at(-1), none.done.at(-1)],
      [
        'reload',
        'recent',
        'pick Reload Window|Open Recent...|Open Documentation',
      ],
    );
  });

  it('F-0601 AC-14: a pick of Choose Container from the recovery picker reopens the picker', async () => {
    const scene = sceneOf({dialog: undefined, picks: ['Choose Container']});
    await scene.present(attachedNotFound('/n'));
    await settled();
    deepStrictEqual(scene.done.at(-1), 'choose');
  });

  it('F-0503 AC-47 (c163-requirements-learn-more): Learn More opens our requirements page and leaves the window disconnected with the recovery picker, whose Learn More item opens it again', async () => {
    const scene = sceneOf({
      dialog: 'Learn More',
      picks: ['Learn More', undefined],
    });
    const outcome = await scene.present(requirementsNotMet('x'));
    await settled();
    await settled();
    deepStrictEqual(
      [outcome, scene.done.slice(1)],
      [
        'handled',
        [
          `open ${CONTAINERS_REQUIREMENTS}`,
          'disconnected',
          'pick Learn More|Open Recent...|Open Documentation',
          `open ${CONTAINERS_REQUIREMENTS}`,
          'pick Learn More|Open Recent...|Open Documentation',
        ],
      ],
    );
  });
});
