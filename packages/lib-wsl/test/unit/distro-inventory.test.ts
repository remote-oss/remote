import {deepStrictEqual} from 'node:assert';
import {createDistroInventory} from '../../src/distro-inventory.ts';
import type {DistroInventory} from '../../src/distro-inventory.ts';
import {createWslRunner} from '../../src/runner.ts';
import {
  type FakeRun,
  fakeWsl,
  utf16Output,
} from '../../src/testing/fake-wsl.ts';

const NEVER = new AbortController().signal;

const LIST = `  NAME            STATE           VERSION\r
* Ubuntu          Running         2\r
  Debian          Stopped         1\r
`;

const LIST_WITH_DOCKER = `${LIST}  docker-desktop  Stopped         2\r\n`;

const STATUS = 'Default Distribution: Ubuntu\r\nWSL version: 2.4.8.0\r\n';

const ONLINE = `The following is a list of valid distributions that can be installed.\r
\r
NAME            FRIENDLY NAME\r
Zed             Zeta Linux\r
Ubuntu          Ubuntu\r
`;

/** What each `wsl.exe` verb gives; a verb not named exits 0 with no output. */
interface Behaviours {
  status?: FakeRun;
  list?: FakeRun;
  listOnline?: FakeRun;
  setDefault?: FakeRun;
  wslconfig?: FakeRun;
}

/** A run that exits with `status` and prints `text` as `wsl.exe` does. */
function printing(text: string, status = 0): FakeRun {
  return {kind: 'exits', stdout: utf16Output(text), status};
}

/** An inventory over a fake that gives each verb its behaviour, with the fake. */
function inventoryOver(
  behaviours: Behaviours,
  windowsBuild: number | null = 26_100,
  session = {},
) {
  const fake = fakeWsl(specification => {
    if (specification.program.endsWith('wslconfig.exe')) {
      return behaviours.wslconfig ?? {kind: 'exits', status: 0};
    }
    const verb = specification.programArguments.join(' ');
    if (verb === '--status') {
      return behaviours.status ?? printing(STATUS);
    }
    if (verb === '--list --verbose') {
      return behaviours.list ?? printing(LIST);
    }
    if (verb === '--list --online') {
      return behaviours.listOnline ?? printing(ONLINE);
    }
    return behaviours.setDefault ?? {kind: 'exits', status: 0};
  }, session);
  fake.local.set('C:\\Windows\\System32\\wslconfig.exe', new Uint8Array(0));
  const runner = createWslRunner(fake);
  return {
    fake,
    inventory: createDistroInventory({
      runner,
      windowsBuild: windowsBuild ?? undefined,
    }),
  };
}

/** The lines of a run, as each process of the fake was started. */
function verbsOf(fake: ReturnType<typeof inventoryOver>['fake']): string[] {
  return fake.started.map(each => each.programArguments.join(' '));
}

describe('D2: the presence of WSL', () => {
  it('F-6101 (D2): a WSL that is not found is absent', async () => {
    const {inventory} = inventoryOver({}, null, {
      systemRoot: undefined,
      environment: {},
    });
    deepStrictEqual(await inventory.presence(NEVER), {kind: 'absent'});
  });

  it('F-6101 (D2): a --status that exits non-zero, as on a machine without the feature, is absent', async () => {
    const {inventory, fake} = inventoryOver({
      status: {kind: 'exits', status: -444},
    });
    deepStrictEqual(
      [await inventory.presence(NEVER), verbsOf(fake)],
      [{kind: 'absent'}, ['--status']],
    );
  });

  it('F-6101 (D2): a --status that cannot be started is absent', async () => {
    const {inventory} = inventoryOver({
      status: {
        kind: 'failsToStart',
        error: {code: 'EMFILE', message: 'too many open files'},
      },
    });
    deepStrictEqual(await inventory.presence(NEVER), {kind: 'absent'});
  });

  for (const status of [-1, 4_294_967_295]) {
    it(`F-6101 (D2): WSL that answers with a list ending in status ${String(status)} has no distro`, async () => {
      const {inventory} = inventoryOver({list: printing('none\r\n', status)});
      deepStrictEqual(await inventory.presence(NEVER), {kind: 'noDistro'});
    });
  }

  it('F-6101 (D2): a list of only the Docker Desktop distros has no distro', async () => {
    const {inventory} = inventoryOver({
      list: printing(
        '  NAME            STATE           VERSION\r\n  docker-desktop  Stopped         2\r\n',
      ),
    });
    deepStrictEqual(await inventory.presence(NEVER), {kind: 'noDistro'});
  });

  it('F-6101 (D2): a distro makes WSL present, with the WSL version and the build', async () => {
    const {inventory} = inventoryOver({}, 22_631);
    deepStrictEqual(await inventory.presence(NEVER), {
      kind: 'present',
      wslVersion: '2.4.8.0',
      windowsBuild: 22_631,
    });
  });

  it('F-6101 (D2): a status without a WSL version leaves the version out, and an unknown build stays unknown', async () => {
    const {inventory} = inventoryOver(
      {status: printing('Default Version: 2\r\n')},
      null,
    );
    deepStrictEqual(await inventory.presence(NEVER), {
      kind: 'present',
      windowsBuild: undefined,
    });
  });

  it('F-6101 (D2): a list that cannot be read, once --status answered, is still present', async () => {
    const {inventory} = inventoryOver({list: printing('boom\r\n', 5)});
    deepStrictEqual(await inventory.presence(NEVER), {
      kind: 'present',
      wslVersion: '2.4.8.0',
      windowsBuild: 26_100,
    });
  });
});

describe('D2: the distros', () => {
  const options = {includeDockerDesktop: false};

  it('F-6102 (D2): gives the rows of the list, without the Docker Desktop distros', async () => {
    const {inventory, fake} = inventoryOver({
      list: printing(LIST_WITH_DOCKER),
    });
    const result = await inventory.distros(options, NEVER);
    deepStrictEqual(
      [
        result.kind === 'rows' ? result.rows.map(each => each.name) : result,
        verbsOf(fake),
      ],
      [['Ubuntu', 'Debian'], ['--list --verbose']],
    );
  });

  it('F-6102 (D2): includes the Docker Desktop distros when asked', async () => {
    const {inventory} = inventoryOver({list: printing(LIST_WITH_DOCKER)});
    const result = await inventory.distros({includeDockerDesktop: true}, NEVER);
    deepStrictEqual(
      result.kind === 'rows' ? result.rows.map(each => each.name) : result,
      ['Ubuntu', 'Debian', 'docker-desktop'],
    );
  });

  for (const status of [-1, 4_294_967_295]) {
    it(`F-6102 (D2): status ${String(status)} is no distro, whatever the text says`, async () => {
      const {inventory} = inventoryOver({
        list: printing('any words at all\r\n', status),
      });
      deepStrictEqual(await inventory.distros(options, NEVER), {
        kind: 'noDistro',
      });
    });
  }

  it('F-6102 (D2): a list with a header and no row, and one with only Docker Desktop and the filter on, are no distro', async () => {
    const empty = inventoryOver({
      list: printing('  NAME            STATE           VERSION\r\n'),
    });
    const docker = inventoryOver({
      list: printing(
        '  NAME            STATE           VERSION\r\n  docker-desktop  Stopped         2\r\n',
      ),
    });
    deepStrictEqual(
      [
        await empty.inventory.distros(options, NEVER),
        await docker.inventory.distros(options, NEVER),
      ],
      [{kind: 'noDistro'}, {kind: 'noDistro'}],
    );
  });

  it('F-6102 (D2): another failing status is the list failing, with the status and WSL’s text', async () => {
    const {inventory} = inventoryOver({list: printing('trouble\r\n', 5)});
    deepStrictEqual(await inventory.distros(options, NEVER), {
      kind: 'listFailed',
      status: 5,
      detail: 'trouble',
    });
  });

  it('F-6102 (D2): a list that does not parse is listFailed', async () => {
    const {inventory} = inventoryOver({
      list: printing('  NAME STATE VERSION\r\nlonely\r\n'),
    });
    deepStrictEqual(await inventory.distros(options, NEVER), {
      kind: 'listFailed',
      status: 0,
      detail: 'the list is not readable: line:1',
    });
  });

  it('F-6102 (D2): a failure of the runner is passed on', async () => {
    const {inventory} = inventoryOver({
      list: {
        kind: 'failsToStart',
        error: {code: 'EMFILE', message: 'too many open files'},
      },
    });
    const result = await inventory.distros(options, NEVER);
    deepStrictEqual(
      result.kind === 'failed' ? result.failure.kind : result.kind,
      'spawnFailed',
    );
  });

  it('F-6102 (D2): two calls made while a read runs share one process, and a later call starts another', async () => {
    const {inventory, fake} = inventoryOver({});
    const [first, second] = await Promise.all([
      inventory.distros(options, NEVER),
      inventory.distros({includeDockerDesktop: true}, NEVER),
    ]);
    const shared = fake.started.length;
    await inventory.distros(options, NEVER);
    deepStrictEqual(
      [first.kind, second.kind, shared, fake.started.length],
      ['rows', 'rows', 1, 2],
    );
  });
});

describe('D2: the cancellation of the callers that share a list read', () => {
  const options = {includeDockerDesktop: false};

  it('F-6102 (D2): a caller that aborts leaves with cancelled at once, and the caller that joined the same read still gets the rows from one process', async () => {
    const {inventory, fake} = inventoryOver({});
    const leaving = new AbortController();
    const first = inventory.distros(options, leaving.signal);
    const second = inventory.distros(options, NEVER);
    leaving.abort();
    const [left, stayed] = await Promise.all([first, second]);
    deepStrictEqual(
      [
        left.kind === 'failed' ? left.failure.kind : left.kind,
        stayed.kind,
        fake.started.length,
      ],
      ['cancelled', 'rows', 1],
    );
  });

  it('F-6102 (D2): when every caller of a read has aborted the process is cancelled, and a later call starts a new one', async () => {
    const {inventory, fake} = inventoryOver({
      list: {kind: 'printsUntilKilled', lines: []},
    });
    const first = new AbortController();
    const second = new AbortController();
    const waits = [
      inventory.distros(options, first.signal),
      inventory.distros(options, second.signal),
    ];
    first.abort();
    second.abort();
    const results = await Promise.all(waits);
    const later = inventory.distros(options, AbortSignal.abort());
    deepStrictEqual(
      [
        results.map(each =>
          each.kind === 'failed' ? each.failure.kind : each.kind,
        ),
        fake.started.length,
        (await later).kind,
        fake.started.length,
      ],
      [['cancelled', 'cancelled'], 1, 'failed', 1],
    );
  });

  it('F-6102 (D2): a call whose signal is already aborted starts no process and does not cancel the read another caller waits for', async () => {
    const {inventory, fake} = inventoryOver({});
    const waiting = inventory.distros(options, NEVER);
    const refused = await inventory.distros(options, AbortSignal.abort());
    const rows = await waiting;
    deepStrictEqual(
      [
        refused.kind === 'failed' ? refused.failure.kind : refused.kind,
        rows.kind,
        fake.started.length,
      ],
      ['cancelled', 'rows', 1],
    );
  });

  it('F-6102 (D2): a call after the cancelled read finished starts a new read that gives the rows', async () => {
    const {inventory, fake} = inventoryOver({});
    const leaving = new AbortController();
    const cancelled = inventory.distros(options, leaving.signal);
    leaving.abort();
    await cancelled;
    const again = await inventory.distros(options, NEVER);
    deepStrictEqual([again.kind, fake.started.length], ['rows', 2]);
  });
});

describe('D2: a listener that throws (card #2515)', () => {
  it('#2515: every listener is called when one throws, and the read still gives its rows', async () => {
    let text = LIST;
    const fake = fakeWsl(() => printing(text));
    const inventory = createDistroInventory({
      runner: createWslRunner(fake),
      windowsBuild: undefined,
    });
    const called: string[] = [];
    inventory.onDidChange(() => {
      called.push('first');
      throw new Error('the first listener fails');
    });
    inventory.onDidChange(() => {
      called.push('second');
    });
    await inventory.distros({includeDockerDesktop: true}, NEVER);
    text = LIST_WITH_DOCKER;
    const second = await inventory.distros({includeDockerDesktop: true}, NEVER);
    deepStrictEqual([called, second.kind], [['first', 'second'], 'rows']);
  });
});

describe('D2: the online catalogue', () => {
  it('F-6102 (D2): gives the rows sorted by friendly name, from --list --online', async () => {
    const {inventory, fake} = inventoryOver({});
    const result = await inventory.onlineCatalogue(NEVER);
    deepStrictEqual(
      [
        result.kind === 'rows' ? result.rows.map(each => each.name) : result,
        verbsOf(fake),
      ],
      [['Ubuntu', 'Zed'], ['--list --online']],
    );
  });

  it('F-6102 (D2): an empty table is no rows', async () => {
    const {inventory} = inventoryOver({listOnline: printing('')});
    deepStrictEqual(await inventory.onlineCatalogue(NEVER), {
      kind: 'rows',
      rows: [],
    });
  });

  it('F-6102 (D2): a non-zero status is unavailable with WSL’s text', async () => {
    const {inventory} = inventoryOver({
      listOnline: printing('no network\r\n', 1),
    });
    deepStrictEqual(await inventory.onlineCatalogue(NEVER), {
      kind: 'unavailable',
      detail: 'no network',
    });
  });

  it('F-6102 (D2): a text that is no table is unavailable with that text', async () => {
    const {inventory} = inventoryOver({
      listOnline: printing('Intro\r\n\r\nNAME\r\nUbuntu\r\n'),
    });
    deepStrictEqual(await inventory.onlineCatalogue(NEVER), {
      kind: 'unavailable',
      detail: 'Intro\n\nNAME\nUbuntu',
    });
  });

  it('F-6102 (D2): a failure of the runner is unavailable with its message', async () => {
    const {inventory} = inventoryOver({
      listOnline: {
        kind: 'failsToStart',
        error: {code: 'EMFILE', message: 'too many open files'},
      },
    });
    deepStrictEqual(await inventory.onlineCatalogue(NEVER), {
      kind: 'unavailable',
      detail: 'too many open files',
    });
  });
});

describe('D2: the default distro', () => {
  it('F-6103 (D2): on a build that allows several distros it runs wsl.exe --set-default', async () => {
    const {inventory, fake} = inventoryOver({}, 18_362);
    deepStrictEqual(
      [await inventory.setDefault('Debian', NEVER), verbsOf(fake)],
      [{kind: 'done'}, ['--set-default Debian']],
    );
  });

  it('F-6103 (D2): on an older build it runs wslconfig.exe /setdefault', async () => {
    const {inventory, fake} = inventoryOver({}, 17_763);
    deepStrictEqual(
      [
        await inventory.setDefault('Debian', NEVER),
        fake.started.map(each => [each.program, each.programArguments]),
      ],
      [
        {kind: 'done'},
        [['C:\\Windows\\System32\\wslconfig.exe', ['/setdefault', 'Debian']]],
      ],
    );
  });

  it('F-6103 (ruling-2348-distro-name): a name that is not valid is invalidName and starts no process', async () => {
    const {inventory, fake} = inventoryOver({});
    deepStrictEqual(
      [await inventory.setDefault('a/b', NEVER), fake.started.length],
      [{kind: 'invalidName'}, 0],
    );
  });

  it('F-6103 (D2): a non-zero status is refused with the status and the text', async () => {
    const {inventory} = inventoryOver({
      setDefault: printing('no such distro\r\n', 1),
    });
    deepStrictEqual(await inventory.setDefault('Nope', NEVER), {
      kind: 'refused',
      status: 1,
      detail: 'no such distro',
    });
  });

  it('F-6103 (D2): a failure of the runner is passed on', async () => {
    const {inventory} = inventoryOver({}, 18_362, {
      systemRoot: undefined,
      environment: {},
    });
    const result = await inventory.setDefault('Debian', NEVER);
    deepStrictEqual(
      result.kind === 'failed' ? result.failure.kind : result.kind,
      'wslMissing',
    );
  });
});

describe('D2: the change of the distros', () => {
  /** An inventory whose list is the one `current` names, changed between reads, and the number of calls of its listener. */
  function watched() {
    let text = LIST;
    let status = 0;
    const fake = fakeWsl(() => printing(text, status));
    const inventory: DistroInventory = createDistroInventory({
      runner: createWslRunner(fake),
      windowsBuild: undefined,
    });
    let calls = 0;
    const subscription = inventory.onDidChange(() => {
      calls += 1;
    });
    return {
      inventory,
      subscription,
      calls: () => calls,
      read: async (next = text, nextStatus = 0) => {
        text = next;
        status = nextStatus;
        await inventory.distros({includeDockerDesktop: true}, NEVER);
      },
    };
  }

  it('F-6102 (D2): the first read does not fire, and an equal read does not either', async () => {
    const seen = watched();
    await seen.read();
    await seen.read();
    deepStrictEqual(seen.calls(), 0);
  });

  const changes = [
    ['a name', LIST.replace('Debian', 'Fedora')],
    [
      'the default marker',
      LIST.replace('* Ubuntu', '  Ubuntu').replace('  Debian', '* Debian'),
    ],
    ['a state', LIST.replace('Running', 'Stopped')],
    ['a version', LIST.replace('Stopped         1', 'Stopped         2')],
    ['the number of rows', LIST_WITH_DOCKER],
  ] as const;
  for (const [what, changed] of changes) {
    it(`F-6102 (D2): a read with ${what} changed fires once`, async () => {
      const seen = watched();
      await seen.read();
      await seen.read(changed);
      deepStrictEqual(seen.calls(), 1);
    });
  }

  it('F-6102 (D2): a disposed listener is not called', async () => {
    const seen = watched();
    await seen.read();
    seen.subscription.dispose();
    await seen.read(LIST_WITH_DOCKER);
    deepStrictEqual(seen.calls(), 0);
  });

  it('F-6102 (D2): a read that failed neither fires nor becomes the read to compare with', async () => {
    const seen = watched();
    await seen.read();
    await seen.read('boom', 5);
    await seen.read(LIST);
    deepStrictEqual(seen.calls(), 0);
  });
});
