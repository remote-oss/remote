import {deepStrictEqual, rejects, strictEqual, throws} from 'node:assert';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {
  acquire,
  type AcquireOutcome,
  type HelperLease,
  nodeClientEnvironment,
  parseRecord,
  recordPath,
  stop,
} from '../../src/index.ts';
import {nodeEndpointPort} from '../../src/endpoint/node-endpoint.ts';
import {nodeFilePort} from '../../src/registry/node-file-port.ts';
import {
  helperParameters,
  inheritedEnvironment,
} from '../../src/runtime/helper-main.ts';

/** The client's waits: a hello, a started helper's listening, the pause between attempts. */
const WAITS = {
  helloLimitMilliseconds: 2000,
  startLimitMilliseconds: 10000,
  retryMilliseconds: 100,
};

const SCRIPT = path.join(
  import.meta.dirname,
  '..',
  'fixtures',
  'echo-helper.ts',
);

const STARTER = path.join(
  import.meta.dirname,
  '..',
  'fixtures',
  'tree-leaving-starter.ts',
);

/** The parent of each live process, read from /proc; a process that ends during the read is left out. */
function parentsOfProcesses(): Map<number, number> {
  const parents = new Map<number, number>();
  for (const entry of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
      parents.set(
        Number(entry),
        Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]),
      );
    } catch {
      // The process ended between the listing and the read.
    }
  }
  return parents;
}

/** The processes whose parent chain leads to `root`. */
function descendantsOf(root: number): number[] {
  const parents = parentsOfProcesses();
  const found: number[] = [];
  let generation = [root];
  while (generation.length > 0) {
    generation = [...parents]
      .filter(([, parent]) => generation.includes(parent))
      .map(([child]) => child);
    found.push(...generation);
  }
  return found;
}

function leaseOf(outcome: AcquireOutcome): HelperLease {
  if (outcome.kind !== 'acquired') {
    throw new Error(`no lease: ${JSON.stringify(outcome)}`);
  }
  return outcome.lease;
}

describe('a helper process', function () {
  this.timeout(20000);
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'helper-'));
  });

  afterEach(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  it('starts once, serves two leases, and ends by its grace after the last release', async () => {
    const environment = {
      ...nodeClientEnvironment(process.execPath, WAITS),
      endpointFolder: folder,
    };
    const request = {
      folder: path.join(folder, 'registry'),
      namespace: 'test.echo',
      helperKey: 'one',
      script: SCRIPT,
      policy: {kind: 'graceAfterLastLease', milliseconds: 300} as const,
      prepare: () =>
        Promise.resolve({
          kind: 'ready' as const,
          options: {},
          payload: {kind: 'echo'},
        }),
      cancellation: new AbortController().signal,
    };
    const first = leaseOf(await acquire(environment, request));
    const second = leaseOf(await acquire(environment, request));
    const reply = await second.request('ping', 5000);
    const secondPosition = second.position();
    const recordText = await nodeFilePort.read(
      recordPath(path.join(folder, 'registry'), 'test.echo', 'one'),
    );
    const endpoint = parseRecord(recordText ?? '')?.endpoint ?? '';
    first.release();
    second.release();
    await delay(1500);
    const reconnect = await nodeEndpointPort()
      .connect(endpoint)
      .then(
        () => 'connected',
        () => 'refused',
      );
    deepStrictEqual(
      [first.startedByMe, second.startedByMe, secondPosition, reply, reconnect],
      [true, false, 1, {kind: 'reply', body: {echo: 'ping'}}, 'refused'],
    );
  });
});

describe("a helper started outside its starter's tree", function () {
  this.timeout(30000);
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'helper-tree-'));
  });

  afterEach(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  (process.platform === 'linux' ? it : it.skip)(
    '(linux) still answers after its starter and every process below the starter are killed',
    async () => {
      const registry = path.join(folder, 'registry');
      const starter = spawn(process.execPath, [STARTER, registry, folder], {
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      const [said] = (await once(
        createInterface({input: starter.stdout}),
        'line',
      )) as [string];
      const starterId = starter.pid ?? 0;
      // The tree is read before anything is killed: a killed parent's children move to another parent.
      const tree = [starterId, ...descendantsOf(starterId)];
      const exited = once(starter, 'exit');
      for (const processId of tree) {
        process.kill(processId, 'SIGKILL');
      }
      await exited;
      const environment = {
        ...nodeClientEnvironment(process.execPath, WAITS),
        endpointFolder: folder,
      };
      const lease = leaseOf(
        await acquire(environment, {
          folder: registry,
          namespace: 'test.echo',
          helperKey: 'tree',
          script: SCRIPT,
          policy: {kind: 'graceAfterLastLease', milliseconds: 300},
          prepare: () =>
            Promise.resolve({kind: 'ready', options: {}, payload: {}}),
          cancellation: new AbortController().signal,
        }),
      );
      const reply = await lease.request('ping', 5000);
      lease.release();
      await stop(environment, registry, 'test.echo', 'tree');
      deepStrictEqual(
        [said, lease.startedByMe, reply],
        ['acquired', false, {kind: 'reply', body: {echo: 'ping'}}],
      );
    },
  );
});

describe('helper parameters', () => {
  it('reads the parameters its client passed', () => {
    strictEqual(
      helperParameters({REMOTE_OSS_HELPER_PARAMETERS: '{"nonce":"n"}'}).nonce,
      'n',
    );
  });

  it('fails without them', () => {
    throws(() => helperParameters({}), {
      message: 'REMOTE_OSS_HELPER_PARAMETERS is not set',
    });
  });
});

describe('the environment a helper passes on', () => {
  it('helper-04: leaves out the variable that runs the editor as Node.js', () => {
    deepStrictEqual(
      inheritedEnvironment({
        ELECTRON_RUN_AS_NODE: '1',
        REMOTE_OSS_HELPER_PARAMETERS: '{}',
        PATH: '/bin',
      }),
      {PATH: '/bin'},
    );
  });

  it("leaves out the variable that carries the helper's parameters", () => {
    deepStrictEqual(
      inheritedEnvironment({
        REMOTE_OSS_HELPER_PARAMETERS: '{"nonce":"n"}',
        PATH: '/bin',
      }),
      {PATH: '/bin'},
    );
  });

  it('keeps every other variable, including one without a value', () => {
    deepStrictEqual(
      inheritedEnvironment({HOME: '/home/user', EMPTY: undefined}),
      {
        HOME: '/home/user',
        EMPTY: undefined,
      },
    );
  });
});

describe('the Node.js registry file port', () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'helper-files-'));
  });

  afterEach(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  it('creates a record once, in a folder it makes', async () => {
    const file = path.join(folder, 'ns', 'a.json');
    deepStrictEqual(
      [
        await nodeFilePort.createExclusive(file, 'one'),
        await nodeFilePort.createExclusive(file, 'two'),
        await nodeFilePort.read(file),
      ],
      ['created', 'exists', 'one'],
    );
  });

  it('reads no record that is not there, and removes one that is not there', async () => {
    const file = path.join(folder, 'none.json');
    await nodeFilePort.remove(file);
    strictEqual(await nodeFilePort.read(file), undefined);
  });

  it('passes on a create the folder refuses', async () => {
    const locked = path.join(folder, 'locked');
    mkdirSync(locked, {mode: 0o500});
    await rejects(
      nodeFilePort.createExclusive(path.join(locked, 'a.json'), 'x'),
    );
  });

  it('passes on other failures of create and read', async () => {
    const outcomes = [
      await nodeFilePort
        .createExclusive(path.join(folder, 'ns'), 'x')
        .then(() =>
          nodeFilePort.createExclusive(path.join(folder, 'ns', 'a.json'), 'x'),
        )
        .then(
          () => 'resolved',
          () => 'rejected',
        ),
      await nodeFilePort.read(folder).then(
        () => 'resolved',
        () => 'rejected',
      ),
    ];
    deepStrictEqual(outcomes, ['rejected', 'rejected']);
  });
});
