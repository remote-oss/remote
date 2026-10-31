import {deepStrictEqual} from 'node:assert';
import type {Failed} from 'lib-authority';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {DevContainerFolder} from '../../src/authority/payload.ts';
import {
  containerSetupFailed,
  containerUnusable,
  disallowedFeature,
  type FailedContainer,
  noServerSource,
  requirementsNotMet,
} from '../../src/connect/failures.ts';
import {inertRecoveryPorts} from './inert-recovery-ports.ts';
import {
  CONTAINERS_DOCUMENTATION,
  CONTAINERS_REQUIREMENTS,
  recoveryPresenterOf,
} from '../../src/surfaces/recovery-presenter.ts';

const TARGET: DevContainerFolder = {
  kind: 'folder',
  hostPath: '/w',
  localDocker: false,
  configFile: {
    $mid: 1,
    fsPath: '/w/.devcontainer/devcontainer.json',
    path: '/w/.devcontainer/devcontainer.json',
    scheme: 'file',
  },
};

const EDIT = 'Edit devcontainer.json Locally';

/** What a row steers: the answers of the dialog and the quick pick, in order. */
interface Script {
  errors?: Array<string | undefined>;
  picks?: Array<string | undefined>;
  target?: DevContainerFolder | undefined;
  keepFails?: boolean;
  /** A rejection of the keep that is not an Error. */
  keepRefusal?: string;
  /** The container the failed connect found. */
  failed?: FailedContainer;
  /** A rejection of the paused retry's store, an Error or a text. */
  storeRefusal?: Error | string;
}

/** A presenter over recording ports; `later` queues its tasks until `flush` runs them. */
function presenting(script: Script = {}) {
  const calls: string[] = [];
  const order: string[] = [];
  const queued: Array<() => void> = [];
  const errors = [...(script.errors ?? [])];
  const picks = [...(script.picks ?? [])];
  const sink = new MemorySink();
  const presenter = recoveryPresenterOf(
    {
      showError: (message, detail, buttons) => {
        calls.push(
          `showError ${message}|${detail}|${buttons
            .map(button =>
              button.isCloseAffordance === true
                ? `${button.title} (close)`
                : button.title,
            )
            .join(',')}`,
        );
        return Promise.resolve(errors.shift());
      },
      pick: (placeholder, labels) => {
        calls.push(`pick ${placeholder}|${labels.join(',')}`);
        return Promise.resolve(picks.shift());
      },
      keepEdit: (folder, configFile) => {
        calls.push(`keepEdit ${folder} ${configFile}`);
        if (script.keepRefusal !== undefined) {
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the row feeds a rejection that is not an Error
          return Promise.reject(script.keepRefusal);
        }
        return script.keepFails === true
          ? Promise.reject(new Error('disk full'))
          : Promise.resolve();
      },
      openLocally: folder => {
        calls.push(`openLocally ${folder}`);
        return Promise.resolve();
      },
      reloadWindow: () => {
        calls.push('reloadWindow');
        return Promise.resolve();
      },
      openRecent: () => {
        calls.push('openRecent');
        return Promise.resolve();
      },
      storePausedRetry: containerId => {
        calls.push(`storePausedRetry ${containerId}`);
        if (script.storeRefusal === undefined) {
          return Promise.resolve();
        }
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the row feeds a rejection that is not an Error
        return Promise.reject(script.storeRefusal);
      },
      rebuildContainer: () => {
        calls.push('rebuildContainer');
        return Promise.resolve();
      },
      openExternal: address => {
        calls.push(`openExternal ${address}`);
        return Promise.resolve();
      },
      openSetting: setting => {
        calls.push(`openSetting ${setting}`);
        return Promise.resolve();
      },
      later: task => {
        calls.push('later');
        queued.push(task);
      },
      disconnected: () => {
        order.push(`disconnected after ${String(calls.length)} calls`);
      },
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
    },
    () => ('target' in script ? script.target : TARGET),
    () => script.failed,
    template => template,
  );
  /** Runs what `later` queued, and waits for the quick pick that follows. */
  async function flush(): Promise<void> {
    while (queued.length > 0) {
      queued.shift()?.();
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  return {presenter, calls, order, flush, sink};
}

async function present(failed: Failed, script: Script = {}) {
  const scene = presenting(script);
  const outcome = await scene.presenter.present(failed);
  return {...scene, outcome};
}

describe('the failure presenter C8 (card containers-11)', () => {
  it('F-0410 AC-3, AC-7, AC-7b: Retry resolves reload', async () => {
    const {outcome, calls} = await present(containerSetupFailed(), {
      errors: ['Retry'],
    });
    deepStrictEqual(
      [outcome, calls],
      [
        'reload',
        [
          `showError |An error occurred setting up the container.|Retry,${EDIT},More Actions... (close)`,
        ],
      ],
    );
  });

  it('F-0409 AC-22, ruling 12: Retry on a paused container leaves the retry for its full id before it reloads', async () => {
    const {outcome, calls} = await present(containerUnusable('paused'), {
      errors: ['Retry'],
      failed: {containerId: 'a'.repeat(64), paused: true},
    });
    deepStrictEqual(
      [outcome, calls.slice(1)],
      ['reload', [`storePausedRetry ${'a'.repeat(64)}`]],
    );
  });

  it('F-0409 AC-7, ruling 12: Retry leaves no retry when the container was not paused, or the connect found none', async () => {
    const running = await present(containerSetupFailed(), {
      errors: ['Retry'],
      failed: {containerId: 'b'.repeat(64), paused: false},
    });
    const none = await present(containerSetupFailed(), {errors: ['Retry']});
    deepStrictEqual(
      [running.outcome, running.calls.length, none.outcome, none.calls.length],
      ['reload', 1, 'reload', 1],
    );
  });

  it('F-0409 ruling 12: a retry that cannot be stored is logged, by its text when it is not an error, and the reload still happens', async () => {
    const failed = {containerId: 'c'.repeat(64), paused: true};
    const broken = await present(containerUnusable('paused'), {
      errors: ['Retry'],
      failed,
      storeRefusal: new Error('disk full'),
    });
    const refused = await present(containerUnusable('paused'), {
      errors: ['Retry'],
      failed,
      storeRefusal: 'quota',
    });
    deepStrictEqual(
      [broken, refused].map(each => [
        each.outcome,
        each.sink.lines.map(line => `${line.level}: ${line.message}`),
      ]),
      [
        [
          'reload',
          [
            'warn: the retry of the paused container could not be kept: disk full',
          ],
        ],
        [
          'reload',
          ['warn: the retry of the paused container could not be kept: quota'],
        ],
      ],
    );
  });

  it('F-0409 AC-34, ruling 14: More Actions... offers Rebuild Container second when the connect found a container, and choosing it rebuilds', async () => {
    const seen = await present(containerSetupFailed(), {
      errors: ['More Actions...'],
      picks: ['Rebuild Container'],
      failed: {containerId: 'd'.repeat(64), paused: false},
    });
    await seen.flush();
    deepStrictEqual(seen.calls.slice(2), [
      `pick Pick an action to help resolve the problem.|Reload Window,Rebuild Container,${EDIT},Open Recent...,Open Documentation`,
      'rebuildContainer',
    ]);
  });

  it('F-0410 AC-4: Edit Locally opens the folder locally and resolves handled', async () => {
    const {outcome, calls} = await present(containerSetupFailed(), {
      errors: [EDIT],
    });
    deepStrictEqual(
      [outcome, calls.slice(1)],
      [
        'handled',
        ['keepEdit /w /w/.devcontainer/devcontainer.json', 'openLocally /w'],
      ],
    );
  });

  it('F-0410 AC-4: Edit Locally keeps the configuration path of this machine, not its URI path', async () => {
    const target: DevContainerFolder = {
      ...TARGET,
      hostPath: 'C:\\w',
      configFile: {
        $mid: 1,
        fsPath: 'C:\\w\\.devcontainer\\devcontainer.json',
        path: '/c:/w/.devcontainer/devcontainer.json',
        scheme: 'file',
      },
    };
    const {calls} = await present(containerSetupFailed(), {
      errors: [EDIT],
      target,
    });
    deepStrictEqual(
      calls[1],
      'keepEdit C:\\w C:\\w\\.devcontainer\\devcontainer.json',
    );
  });

  it('F-0410 AC-4: Edit Locally keeps the configuration path from path when fsPath is absent', async () => {
    const target: DevContainerFolder = {
      ...TARGET,
      configFile: {$mid: 1, path: '/w/.devcontainer.json', scheme: 'file'},
    };
    const {calls} = await present(containerSetupFailed(), {
      errors: ['Edit .devcontainer.json Locally'],
      target,
    });
    deepStrictEqual(calls[1], 'keepEdit /w /w/.devcontainer.json');
  });

  it("F-0410 AC-4: a pending edit that can't be stored is logged, and the folder still opens", async () => {
    const {calls, sink} = await present(containerSetupFailed(), {
      errors: [EDIT],
      keepFails: true,
    });
    deepStrictEqual(
      [calls.at(-1), sink.lines.map(line => `${line.level}: ${line.message}`)],
      [
        'openLocally /w',
        [
          'warn: the configuration file could not be kept for the next window: disk full',
        ],
      ],
    );
  });

  it('contracts: a pending edit refused with a text that is not an error is logged by that text, and the folder still opens', async () => {
    const {calls, sink} = await present(containerSetupFailed(), {
      errors: [EDIT],
      keepRefusal: 'quota',
    });
    deepStrictEqual(
      [calls.at(-1), sink.lines.map(line => `${line.level}: ${line.message}`)],
      [
        'openLocally /w',
        [
          'warn: the configuration file could not be kept for the next window: quota',
        ],
      ],
    );
  });

  it('F-0503 7.E1: Learn More opens the requirements page, resolves handled, then shows the pick', async () => {
    const seen = await present(requirementsNotMet('Error: Missing GLIBC'), {
      errors: ['Learn More'],
      picks: [undefined],
    });
    const before = [...seen.calls];
    await seen.flush();
    deepStrictEqual(
      [seen.outcome, before.slice(1), seen.calls.slice(before.length)],
      [
        'handled',
        [`openExternal ${CONTAINERS_REQUIREMENTS}`, 'later'],
        [
          `pick Pick an action to help resolve the problem.|Reload Window,${EDIT},Open Recent...,Open Documentation`,
        ],
      ],
    );
  });

  it('F-0410 AC-5: More Actions resolves handled, then shows the quick pick once the call has returned', async () => {
    const seen = await present(containerSetupFailed(), {
      errors: ['More Actions...'],
      picks: [undefined],
    });
    const beforeFlush = [seen.outcome, seen.calls.length, seen.calls.at(-1)];
    await seen.flush();
    deepStrictEqual(
      [beforeFlush, seen.calls[2]?.startsWith('pick ')],
      [['handled', 2, 'later'], true],
    );
  });

  it('F-0410 5.0 step 4: More Actions... and Escape tell the window it is disconnected once, before the quick pick is queued', async () => {
    const button = await present(containerSetupFailed(), {
      errors: ['More Actions...'],
    });
    const escape = await present(containerSetupFailed(), {
      errors: [undefined],
    });
    deepStrictEqual(
      [button.order, button.calls, escape.order],
      [
        ['disconnected after 1 calls'],
        [
          `showError |An error occurred setting up the container.|Retry,${EDIT},More Actions... (close)`,
          'later',
        ],
        ['disconnected after 1 calls'],
      ],
    );
  });

  it("F-0414 AC-19: Learn More on a disallowed Feature opens the manifest entry's address, not the requirements page", async () => {
    const {calls} = await present(
      disallowedFeature('ghcr.io/o/f:1', false, 'https://example.org/f'),
      {errors: ['Learn More'], picks: [undefined]},
    );
    deepStrictEqual(
      calls.filter(call => call.startsWith('openExternal')),
      ['openExternal https://example.org/f'],
    );
  });

  it('F-0503 7.E1: Learn More tells the window it is disconnected once, after the requirements page opens', async () => {
    const seen = await present(requirementsNotMet('Error: Missing GLIBC'), {
      errors: ['Learn More'],
    });
    deepStrictEqual(seen.order, ['disconnected after 2 calls']);
  });

  it('F-0410 5.0 step 4: Retry, Edit Locally and the window with no server source never tell the window it is disconnected', async () => {
    const retry = await present(containerSetupFailed(), {errors: ['Retry']});
    const edit = await present(containerSetupFailed(), {errors: [EDIT]});
    const source = await present(noServerSource('VSCodium'), {
      errors: ['Cancel'],
    });
    deepStrictEqual([retry.order, edit.order, source.order], [[], [], []]);
  });

  it('F-0410 5.0 step 2: only More Actions... is the close affordance, in a requirements dialog too, so the editor adds no Cancel', async () => {
    const failing = presenting({errors: ['Retry']});
    await failing.presenter.present(containerSetupFailed());
    const requirements = presenting({errors: ['Learn More']});
    await requirements.presenter.present(
      requirementsNotMet('Error: Missing GLIBC'),
    );
    deepStrictEqual(
      [failing.calls[0], requirements.calls[0]?.split('|')[2]],
      [
        `showError |An error occurred setting up the container.|Retry,${EDIT},More Actions... (close)`,
        `Learn More,${EDIT},More Actions... (close)`,
      ],
    );
  });

  it('F-0410 6.3: Escape is More Actions', async () => {
    const seen = await present(containerSetupFailed(), {
      errors: [undefined],
      picks: [undefined],
    });
    await seen.flush();
    deepStrictEqual(
      [seen.outcome, seen.calls.map(call => call.split(' ')[0])],
      ['handled', ['showError', 'later', 'pick']],
    );
  });

  it('F-0202 AC-18: Reload Window reloads', async () => {
    const seen = await present(containerSetupFailed(), {
      errors: ['More Actions...'],
      picks: ['Reload Window'],
    });
    await seen.flush();
    deepStrictEqual(seen.calls.at(-1), 'reloadWindow');
  });

  it("F-0410 AC-8: the quick pick's Edit is the button's", async () => {
    const seen = await present(containerSetupFailed(), {
      errors: ['More Actions...'],
      picks: [EDIT],
    });
    await seen.flush();
    deepStrictEqual(seen.calls.slice(-2), [
      'keepEdit /w /w/.devcontainer/devcontainer.json',
      'openLocally /w',
    ]);
  });

  it('F-0410 AC-9: Open Recent runs openRecent', async () => {
    const seen = await present(containerSetupFailed(), {
      errors: ['More Actions...'],
      picks: ['Open Recent...'],
    });
    await seen.flush();
    deepStrictEqual(seen.calls.at(-1), 'openRecent');
  });

  it('F-0410 AC-9b, F-0202 AC-10: Open Documentation opens the address and shows the same pick again', async () => {
    const seen = await present(containerSetupFailed(), {
      errors: ['More Actions...'],
      picks: ['Open Documentation', undefined],
    });
    await seen.flush();
    deepStrictEqual(
      seen.calls.slice(2).map(call => call.split('|')[0]),
      [
        'pick Pick an action to help resolve the problem.',
        `openExternal ${CONTAINERS_DOCUMENTATION}`,
        'pick Pick an action to help resolve the problem.',
      ],
    );
  });

  it('F-0202 AC-19: Escape on the quick pick does nothing more', async () => {
    const seen = await present(containerSetupFailed(), {
      errors: ['More Actions...'],
      picks: [undefined],
    });
    await seen.flush();
    deepStrictEqual(seen.calls.length, 3);
  });

  it('F-0410: with no target the dialog and the pick have no Edit', async () => {
    const seen = await present(containerSetupFailed(), {
      errors: ['More Actions...'],
      picks: [undefined],
      target: undefined,
    });
    await seen.flush();
    deepStrictEqual(
      seen.calls.map(call => call.includes('Locally')),
      [false, false, false],
    );
  });

  it('contracts §3.11: noServerSource keeps Open Setting and Cancel, and Open Setting opens the setting', async () => {
    const {outcome, calls} = await present(noServerSource('VSCodium'), {
      errors: ['Open Setting'],
    });
    deepStrictEqual(
      [outcome, calls],
      [
        'handled',
        [
          "showError |remote-oss.remote-containers has no built-in VS Code Server download location for VSCodium. Set remote.serverDownloadBaseUrl to a URL template for this editor's own server builds.|Open Setting,Cancel",
          'openSetting remote.serverDownloadBaseUrl',
        ],
      ],
    );
  });

  it('contracts §3.11: Cancel and Escape on noServerSource open nothing', async () => {
    const cancelled = await present(noServerSource('VSCodium'), {
      errors: ['Cancel'],
    });
    const escaped = await present(noServerSource('VSCodium'), {
      errors: [undefined],
    });
    deepStrictEqual(
      [
        cancelled.outcome,
        cancelled.calls.length,
        escaped.outcome,
        escaped.calls.length,
      ],
      ['handled', 1, 'handled', 1],
    );
  });

  it("F-0410 AC-2: the presenter doesn't resolve while the dialog is open", async () => {
    let answer: ((label: string | undefined) => void) | undefined;
    const presenter = recoveryPresenterOf(
      inertRecoveryPorts({
        showError: () =>
          new Promise<string | undefined>(resolve => {
            answer = resolve;
          }),
      }),
      () => TARGET,
      () => undefined,
      template => template,
    );
    let settled = false;
    const running = presenter.present(containerSetupFailed()).then(outcome => {
      settled = true;
      return outcome;
    });
    await new Promise(resolve => setImmediate(resolve));
    const whileOpen = settled;
    answer?.('Retry');
    deepStrictEqual([whileOpen, await running], [false, 'reload']);
  });

  it('R-31: every address is https and names neither aka.ms nor microsoft.com', () => {
    deepStrictEqual(
      [CONTAINERS_DOCUMENTATION, CONTAINERS_REQUIREMENTS].filter(
        address =>
          !address.startsWith('https://') ||
          address.includes('aka.ms') ||
          address.includes('microsoft.com'),
      ),
      [],
    );
  });
});
