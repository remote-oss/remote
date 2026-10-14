import {deepStrictEqual} from 'node:assert';
import type {Failed} from 'lib-authority';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {DevContainerFolder} from '../../src/authority/payload.ts';
import {
  containerSetupFailed,
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
}

/** A presenter over recording ports; `later` queues its tasks until `flush` runs them. */
function presenting(script: Script = {}) {
  const calls: string[] = [];
  const queued: Array<() => void> = [];
  const errors = [...(script.errors ?? [])];
  const picks = [...(script.picks ?? [])];
  const sink = new MemorySink();
  const presenter = recoveryPresenterOf(
    {
      showError: (message, detail, buttons) => {
        calls.push(`showError ${message}|${detail}|${buttons.join(',')}`);
        return Promise.resolve(errors.shift());
      },
      pick: (placeholder, labels) => {
        calls.push(`pick ${placeholder}|${labels.join(',')}`);
        return Promise.resolve(picks.shift());
      },
      keepEdit: (folder, configFile) => {
        calls.push(`keepEdit ${folder} ${configFile}`);
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
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
    },
    () => ('target' in script ? script.target : TARGET),
    template => template,
  );
  /** Runs what `later` queued, and waits for the quick pick that follows. */
  async function flush(): Promise<void> {
    while (queued.length > 0) {
      queued.shift()?.();
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  return {presenter, calls, flush, sink};
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
          `showError |An error occurred setting up the container.|Retry,${EDIT},More Actions...`,
        ],
      ],
    );
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
