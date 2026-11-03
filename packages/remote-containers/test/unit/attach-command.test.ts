import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {decodeAuthority, type DecodedTarget} from 'lib-authority';
import {
  type AttachPicker,
  type AttachPorts,
  attachToRunningContainer,
} from '../../src/attach/attach-command.ts';
import type {AttachItem} from '../../src/attach/containers.ts';
import {runningItemsOf} from '../../src/attach/containers.ts';
import {
  ATTACH_TRUST_KEY,
  ATTACH_TRUST_PAGE,
  attachWarningAccepted,
} from '../../src/attach/warning.ts';
import {wslRootOf} from '../../src/attach/payload.ts';
import type {
  EngineHost,
  EngineRunOutcome,
} from '../../src/engine/engine-host.ts';

/** A container as `docker inspect` prints it. */
function inspected(
  name: string,
  image: string,
  identifier: string,
  status = 'running',
): Record<string, unknown> {
  return {
    ['Id']: identifier,
    Name: `/${name}`,
    Created: '2026-11-01T00:00:00Z',
    Config: {Image: image, Labels: {}},
    State: {Status: status},
  };
}

function fullId(digit: string): string {
  return digit.repeat(64);
}

/** An engine that answers `ps` with `ids` and `inspect` with `containers`. */
function engineOf(
  listed: readonly string[],
  containers: readonly unknown[],
  failures: {listing?: EngineRunOutcome; inspection?: EngineRunOutcome} = {},
): {engine: EngineHost; calls: string[][]} {
  const calls: string[][] = [];
  const engine: EngineHost = {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: argv => {
      calls.push([...argv]);
      if (argv[0] === 'ps') {
        return Promise.resolve(
          failures.listing ?? {
            kind: 'ran',
            status: 0,
            stdout: listed.map(each => `${each}\n`).join(''),
            stderr: '',
          },
        );
      }
      return Promise.resolve(
        failures.inspection ?? {
          kind: 'ran',
          status: 1,
          stdout: JSON.stringify(containers),
          stderr: 'Error: No such container',
        },
      );
    },
    spawn: () => Promise.resolve({kind: 'failed', detail: 'no spawn'}),
  };
  return {engine, calls};
}

const SIGNAL = new AbortController().signal;

describe('the running containers of the attach picker (card containers-162, brief-attach §2)', () => {
  it('F-0601 BR-3, AC-49: the items are the running containers, labelled with their names, described by image and id, in the collator’s order', async () => {
    const names = [
      'zeta',
      'Alpha',
      'beta-2',
      'beta_1',
      'beta-1',
      'alpha',
      '_x',
    ];
    const {engine, calls} = engineOf(
      names.map((name, position) => fullId(position.toString())),
      names.map((name, position) =>
        inspected(
          name,
          `img${position.toString()}:1`,
          fullId(position.toString()),
        ),
      ),
    );
    const items = await runningItemsOf(engine, SIGNAL);
    deepStrictEqual(
      [
        'failed' in items ? items : items.map(each => each.label),
        'failed' in items ? [] : items.map(each => each.description.length),
        calls[0],
      ],
      [
        ['/_x', '/alpha', '/Alpha', '/beta_1', '/beta-1', '/beta-2', '/zeta'],
        Array.from({length: 7}, () => 'imgN:1'.length + 1 + 64),
        ['ps', '-q', '--no-trunc', '--filter', 'status=running'],
      ],
    );
  });

  it('F-0601 7.E5, BR-2: a container that inspect no longer finds, and one that is not running by then, is left out', async () => {
    const {engine} = engineOf(
      [fullId('1'), fullId('2'), fullId('3')],
      [
        inspected('kept', 'a:1', fullId('1')),
        inspected('stopped', 'b:1', fullId('3'), 'exited'),
      ],
    );
    const items = await runningItemsOf(engine, SIGNAL);
    deepStrictEqual('failed' in items ? items : items.map(each => each.label), [
      '/kept',
    ]);
  });

  it('F-0601 7.E1: no running container gives an empty list and asks inspect nothing', async () => {
    const {engine, calls} = engineOf([], []);
    deepStrictEqual(
      [await runningItemsOf(engine, SIGNAL), calls.length],
      [[], 1],
    );
  });

  it('F-0601 7.E7: a listing that fails, in either query, is told with its first line', async () => {
    const psFailed = engineOf([], [], {
      listing: {kind: 'ran', status: 1, stdout: '', stderr: 'boom\nmore'},
    });
    const psSpawn = engineOf([], [], {
      listing: {kind: 'failed', detail: 'spawn docker ENOENT'},
    });
    const psSilent = engineOf([], [], {
      listing: {kind: 'ran', status: 2, stdout: '', stderr: ''},
    });
    const inspectGarbled = engineOf([fullId('1')], [], {
      inspection: {kind: 'ran', status: 0, stdout: 'x', stderr: ''},
    });
    const inspectSpawn = engineOf([fullId('1')], [], {
      inspection: {kind: 'failed', detail: 'killed'},
    });
    deepStrictEqual(
      await Promise.all(
        [psFailed, psSpawn, psSilent, inspectGarbled, inspectSpawn].map(scene =>
          runningItemsOf(scene.engine, SIGNAL),
        ),
      ),
      [
        {failed: 'boom'},
        {failed: 'spawn docker ENOENT'},
        {failed: 'docker ended with status 2'},
        {failed: 'docker inspect gave no containers'},
        {failed: 'killed'},
      ],
    );
  });
});

describe('the attach warning (card containers-162, brief-attach §7.1)', () => {
  function sceneOf(
    stored: unknown,
    answer: string | undefined,
  ): {
    shown: Array<[string, string, readonly string[]]>;
    opened: string[];
    writes: unknown[][];
    accepted(): Promise<boolean>;
  } {
    const shown: Array<[string, string, readonly string[]]> = [];
    const opened: string[] = [];
    const writes: unknown[][] = [];
    return {
      shown,
      opened,
      writes,
      accepted: () =>
        attachWarningAccepted({
          global: {
            get: key => (key === ATTACH_TRUST_KEY ? stored : undefined),
            update: (key, value) => {
              writes.push([key, value]);
              return Promise.resolve();
            },
          },
          show: (message, detail, buttons) => {
            shown.push([message, detail, buttons]);
            return Promise.resolve(answer);
          },
          openExternal: address => {
            opened.push(address);
            return Promise.resolve();
          },
          translate: template => template,
        }),
    };
  }

  it('F-0601 PRE-2, AC-10: Got It is kept in the profile, and a profile that kept it is not asked', async () => {
    const asked = sceneOf(undefined, 'Got It');
    const kept = sceneOf(true, undefined);
    deepStrictEqual(
      [
        await asked.accepted(),
        await kept.accepted(),
        asked.shown,
        asked.writes,
        kept.shown,
      ],
      [
        true,
        true,
        [
          [
            'Attaching to a container may execute arbitrary code.',
            'Only attach to a container if you trust its origin.',
            ['Got It', 'Learn More'],
          ],
        ],
        [[ATTACH_TRUST_KEY, true]],
        [],
      ],
    );
  });

  it('F-0601 PRE-2, AC-17: Learn More opens the page and ends the command, and Cancel or Escape ends it; neither keeps anything, and a stored value other than true does not count as accepted', async () => {
    const learn = sceneOf(undefined, 'Learn More');
    const cancel = sceneOf(undefined, undefined);
    const other = sceneOf('yes', 'Got It');
    deepStrictEqual(
      [
        await learn.accepted(),
        await cancel.accepted(),
        await other.accepted(),
        learn.opened,
        learn.writes,
        cancel.opened,
        cancel.writes,
      ],
      [false, false, true, [ATTACH_TRUST_PAGE], [], [], []],
    );
  });
});

describe('the attach command (card containers-162, brief-attach §2)', () => {
  const NGINX = inspected('web', 'nginx:1', fullId('a'));

  /** What the fakes saw and what a row steers. */
  interface Scene {
    events: string[];
    picked: AttachItem | undefined;
    filled: AttachItem[];
    warning: boolean;
    check: 'proceed' | 'stopped';
    engine: EngineHost | undefined;
    files: Record<string, string>;
    unreadable: boolean;
    opened: Array<[string, string | undefined]>;
    labels: Array<[DecodedTarget, string]>;
    modals: Array<[string, string, string]>;
    refused: boolean;
  }

  function sceneOf(containers: readonly unknown[]): Scene {
    return {
      events: [],
      picked: undefined,
      filled: [],
      warning: true,
      check: 'proceed',
      engine: engineOf(
        containers.map(each => (each as {Id: string}).Id),
        containers,
      ).engine,
      files: {},
      unreadable: false,
      opened: [],
      labels: [],
      modals: [],
      refused: false,
    };
  }

  async function attach(
    scene: Scene,
    pinned: Record<string, string> = {},
    distroRoot?: string,
  ): Promise<void> {
    const sink = new MemorySink();
    const ports: AttachPorts = {
      warning: () => {
        scene.events.push('warning');
        return Promise.resolve(scene.warning);
      },
      engine: () => scene.engine,
      checks: () => {
        scene.events.push('checks');
        return Promise.resolve(scene.check);
      },
      openPicker: (): AttachPicker => {
        scene.events.push('picker open');
        return {
          fill: items => {
            scene.events.push('picker fill');
            scene.filled.push(...items);
          },
          chosen: Promise.resolve(scene.picked),
          close: () => {
            scene.events.push('picker close');
          },
        };
      },
      showModal: (message, detail, button) => {
        scene.events.push('modal');
        scene.modals.push([message, detail, button]);
        return Promise.resolve();
      },
      configFiles: (image, name) => ({
        name: `/s/names/${name}.json`,
        image: `/s/images/${image.replaceAll(':', '%3a')}.json`,
      }),
      exists: file => Promise.resolve(file in scene.files),
      readText: file =>
        scene.unreadable
          ? Promise.reject(new Error('EACCES'))
          : Promise.resolve(scene.files[file] ?? ''),
      pinnedEngine: () => Promise.resolve(pinned),
      wslRoot: () => distroRoot,
      registerLabel: (decoded, suffix) => {
        scene.labels.push([decoded, suffix]);
      },
      openWindow: (authority, folder) => {
        scene.events.push('open');
        scene.opened.push([authority, folder]);
        return Promise.resolve(
          scene.refused ? {kind: 'rejected', reason: 'no'} : {kind: 'opened'},
        );
      },
      translate: template => template,
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
      cancellation: SIGNAL,
    };
    await attachToRunningContainer(ports);
  }

  it('F-0601 5.0: the warning comes first, then the checks, and only then the picker opens, busy until the list fills it', async () => {
    const scene = sceneOf([NGINX]);
    await attach(scene);
    deepStrictEqual(
      [scene.events, scene.filled.map(each => each.label)],
      [['warning', 'checks', 'picker open', 'picker fill'], ['/web']],
    );
  });

  it('F-0601 PRE-2: a warning that is not accepted ends the command before anything else', async () => {
    const scene = sceneOf([NGINX]);
    scene.warning = false;
    await attach(scene);
    deepStrictEqual(scene.events, ['warning']);
  });

  it('F-0601 PRE-1 (a), (b): no Docker program shows the check’s dialog and opens no picker', async () => {
    const scene = sceneOf([NGINX]);
    scene.engine = undefined;
    await attach(scene);
    deepStrictEqual(scene.events, ['warning', 'checks']);
  });

  it('F-0601 PRE-1 (c), (d), 7.E7: a check that stops opens no picker and lists nothing', async () => {
    const scene = sceneOf([NGINX]);
    scene.check = 'stopped';
    await attach(scene);
    deepStrictEqual(scene.events, ['warning', 'checks']);
  });

  it('F-0601 7.E1, BR-9: no running container closes the picker and shows S365 as a modal with OK', async () => {
    const scene = sceneOf([]);
    await attach(scene);
    deepStrictEqual(
      [scene.events, scene.modals],
      [
        ['warning', 'checks', 'picker open', 'picker close', 'modal'],
        [['', 'There are no running containers to attach to.', 'OK']],
      ],
    );
  });

  it('F-0601 7.E7: a listing that fails closes the picker and shows the engine’s words in a modal', async () => {
    const scene = sceneOf([]);
    scene.engine = engineOf([], [], {
      listing: {kind: 'ran', status: 1, stdout: '', stderr: 'denied'},
    }).engine;
    await attach(scene);
    deepStrictEqual(scene.modals, [
      ['Docker returned an error.', 'denied', 'OK'],
    ]);
  });

  it('F-0601 POST-2, BR-5: a dismissed picker opens nothing, and a pick opens a new window on the attached authority, registers the label first, and opens folderless without a file', async () => {
    const scene = sceneOf([NGINX]);
    await attach(scene);
    scene.picked = scene.filled[0];
    const again = sceneOf([NGINX]);
    again.picked = {
      label: '/web',
      description: '',
      containerId: fullId('a'),
      image: 'nginx:1',
      name: 'web',
    };
    await attach(again, {context: 'remote'});
    const [authority, folder] = again.opened[0] ?? ['', ''];
    const decoded = decodeAuthority(authority);
    deepStrictEqual(
      [
        scene.opened,
        'malformed' in decoded ? decoded : [decoded.family, folder],
        again.labels.map(each => each[1]),
        again.events.indexOf('open') > again.events.indexOf('picker fill'),
      ],
      [
        [],
        ['attached-container', undefined],
        ['Container nginx:1 (web) @ remote'],
        true,
      ],
    );
  });

  it('F-0602 BR-1, E6, AC-27: the folder the applicable file names is where the window opens; the name’s file wins over the image’s; a file that is not absolute, unreadable, or absent gives a window with no folder', async () => {
    const outcomes: Array<string | undefined> = [];
    for (const files of [
      {
        '/s/names/web.json': '{"workspaceFolder":"/srv/n"}',
        '/s/images/nginx%3a1.json': '{"workspaceFolder":"/srv/i"}',
      },
      {'/s/images/nginx%3a1.json': '{"workspaceFolder":"/srv/i"}'},
      {'/s/names/web.json': '{"workspaceFolder":"srv"}'},
      {},
    ]) {
      const scene = sceneOf([NGINX]);
      scene.files = files;
      scene.picked = {
        label: '/web',
        description: '',
        containerId: fullId('a'),
        image: 'nginx:1',
        name: 'web',
      };
      await attach(scene);
      outcomes.push(scene.opened[0]?.[1]);
    }
    const broken = sceneOf([NGINX]);
    broken.files = {'/s/names/web.json': '{}'};
    broken.unreadable = true;
    broken.picked = {
      label: '/web',
      description: '',
      containerId: fullId('a'),
      image: 'nginx:1',
      name: 'web',
    };
    await attach(broken);
    outcomes.push(broken.opened[0]?.[1]);
    deepStrictEqual(outcomes, [
      '/srv/n',
      '/srv/i',
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('F-0601 BR-8: a WSL window’s root and a refusal of the opener are carried; the refusal is only logged', async () => {
    const scene = sceneOf([NGINX]);
    scene.refused = true;
    scene.picked = {
      label: '/web',
      description: '',
      containerId: fullId('a'),
      image: 'nginx:1',
      name: 'web',
    };
    await attach(scene, {}, '\\\\wsl.localhost\\Ubuntu');
    const decoded = decodeAuthority(scene.opened[0]?.[0] ?? '');
    deepStrictEqual(
      [
        'malformed' in decoded
          ? decoded
          : Buffer.from(
              'payload' in decoded.target ? decoded.target.payload : '',
              'hex',
            ).toString('utf8'),
        scene.opened.length,
      ],
      ['{"containerName":"/web","cwd":"\\\\\\\\wsl.localhost\\\\Ubuntu"}', 1],
    );
  });

  it('F-0601 BR-8: a WSL window’s authority gives the distro’s UNC root, and no other window gives one', () => {
    deepStrictEqual(
      [
        wslRootOf('wsl+Ubuntu-24.04'),
        wslRootOf('wsl+'),
        wslRootOf('dev-container+ab'),
        wslRootOf(undefined),
      ],
      ['\\\\wsl.localhost\\Ubuntu-24.04', undefined, undefined, undefined],
    );
  });
});
