import {deepStrictEqual, strictEqual} from 'node:assert';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import type {ConnectionNotice, ConnectOutcome, SharedConnection} from 'lib-ssh';
import {startHost, type RunningHost} from './host-fixture.ts';
import {WindowSide} from './real-connection.ts';

const PASSPHRASE = 'correct horse battery staple';

/** The time a test gives a thing to happen that has no event to wait for, in milliseconds. */
const SETTLE = 4000;

/** Waits until `condition` holds, or the time given has passed; true when it held. */
async function eventually(
  condition: () => boolean,
  milliseconds = SETTLE,
): Promise<boolean> {
  const deadline = Date.now() + milliseconds;
  while (!condition()) {
    if (Date.now() > deadline) {
      return false;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return true;
}

describe('slice 1: the shared connection, with the bundled helper and the real ssh', function () {
  this.timeout(120000);
  let host: RunningHost;
  let windows: WindowSide;

  before(async () => {
    host = await startHost();
  });

  after(() => {
    host.stop();
  });

  beforeEach(() => {
    windows = new WindowSide();
  });

  afterEach(async () => {
    await windows.kill('harness');
    await windows.kill('locked');
    windows.remove();
  });

  async function window(
    alias = 'harness',
  ): Promise<{connection: SharedConnection; notices: ConnectionNotice[]}> {
    const acquired = await windows.acquire(host.baseOf(alias));
    if (acquired.kind !== 'acquired') {
      throw new Error(`no lease: ${acquired.failure}`);
    }
    const notices: ConnectionNotice[] = [];
    acquired.connection.onNotice(notice => notices.push(notice));
    return {connection: acquired.connection, notices};
  }

  async function connected(
    alias = 'harness',
  ): Promise<{connection: SharedConnection; outcome: ConnectOutcome}> {
    const {connection} = await window(alias);
    return {
      connection,
      outcome: await connection.connect(new AbortController().signal),
    };
  }

  describe('F-2102 one connection server for every window of a host', () => {
    it('F-2102: two windows share one ssh login and one SOCKS port', async () => {
      const before = host.logins();
      const first = await connected();
      const second = await connected();
      deepStrictEqual(
        [
          first.outcome.kind,
          second.outcome.kind,
          second.outcome.kind === 'connected' &&
            first.outcome.kind === 'connected' &&
            second.outcome.socksPort === first.outcome.socksPort,
          host.logins() - before,
        ],
        ['connected', 'connected', true, 1],
      );
    });

    it('F-2102: what the first window stores for the server reaches the second', async () => {
      const first = await connected();
      await first.connection.storeSharedRecord({
        remotePort: 41001,
        operatingSystem: 'linux',
        architecture: 'x64',
        temporaryFolder: '/tmp',
        connectionToken: 'token-value',
      });
      const second = await connected();
      strictEqual(
        second.outcome.kind === 'connected'
          ? second.outcome.sharedRecord?.remotePort
          : second.outcome.kind,
        41001,
      );
    });

    it('F-2103: a reload within the grace joins the helper that runs, with no new login', async () => {
      const first = await connected();
      const loginsBefore = host.logins();
      first.connection.release();
      const reloaded = await connected();
      deepStrictEqual(
        [reloaded.outcome.kind, host.logins() - loginsBefore],
        ['connected', 0],
      );
    });

    it('F-2102.BR-7: killing the server ends its ssh session on the host and its record', async () => {
      await connected();
      const recordsBefore = windows.records().length;
      await windows.kill('harness');
      const gone = await eventually(
        () =>
          host
            .onHost('sh', '-c', 'ps | grep -c "[s]shd: harness" || true')
            .trim() === '0',
      );
      deepStrictEqual([recordsBefore, gone, windows.records()], [1, true, []]);
    });

    it('F-2102.BR-7: killing a server that does not run is a success, silently', async () => {
      await windows.kill('harness');
      deepStrictEqual(windows.records(), []);
    });
  });

  describe('F-2601 a host that cannot be reached', () => {
    it('F-2601: a TEST-NET host ends as a failed login of a kind that says so, with its hints, within the bound', async () => {
      host.appendConfig(
        'Host unreachable\n  HostName 192.0.2.1\n  User harness\n  IdentitiesOnly yes\n  IdentityAgent none\n  BatchMode yes\n  ConnectTimeout 3\n',
      );
      const started = Date.now();
      const {connection} = await window('unreachable');
      const outcome = await connection.connect(new AbortController().signal);
      await windows.kill('unreachable');
      deepStrictEqual(
        [
          outcome.kind === 'failed' ? outcome.failure.kind : outcome.kind,
          outcome.kind === 'failed' && outcome.failure.kind === 'loginFailed'
            ? ['timeout', 'unreachable'].includes(outcome.failure.failure)
            : false,
          Date.now() - started < 15000,
        ],
        ['loginFailed', true, true],
      );
    });
  });

  describe('F-2101 a client that is missing', () => {
    it('F-2101: a program that is not there is told as a failed start of a vanished client', async () => {
      const base = host.baseOf('harness');
      const acquired = await windows.acquire({
        ...base,
        programs: {...base.programs, sshProgram: '/nonexistent/ssh'},
      });
      if (acquired.kind !== 'acquired') {
        throw new Error(`no lease: ${acquired.failure}`);
      }
      const outcome = await acquired.connection.connect(
        new AbortController().signal,
      );
      deepStrictEqual(
        outcome.kind === 'failed' ? outcome.failure.kind : outcome.kind,
        'spawnFailed',
      );
    });
  });

  describe('F-2305 a passphrase asked by ssh reaches the window through the askpass endpoint', () => {
    before(() => {
      const keyFile = path.join(host.runFolder, 'id_locked');
      host.generateKey(keyFile, PASSPHRASE);
      host.authorize(`${keyFile}.pub`);
      host.appendConfig(
        `Host locked\n  HostName 127.0.0.1\n  Port ${String(host.port)}\n  User harness\n  IdentityFile ${keyFile}\n  IdentitiesOnly yes\n  IdentityAgent none\n  StrictHostKeyChecking accept-new\n  ConnectTimeout 10\n  UserKnownHostsFile ${path.join(host.runFolder, 'known_hosts')}\n`,
      );
    });

    it('F-2305: the question is shown as a masked input, and the answer lets the login finish', async () => {
      const {connection, notices} = await window('locked');
      const waiting = connection.connect(new AbortController().signal);
      const asked = await eventually(() =>
        notices.some(notice => notice.type === 'prompt'),
      );
      const prompt = notices.find(notice => notice.type === 'prompt');
      const accepted =
        prompt?.type === 'prompt'
          ? await connection.answer(prompt.promptId, PASSPHRASE)
          : false;
      const outcome = await waiting;
      deepStrictEqual(
        [
          asked,
          prompt?.type === 'prompt' && prompt.surface,
          prompt?.type === 'prompt' && prompt.text.includes('passphrase'),
          accepted,
          outcome.kind,
        ],
        [true, 'maskedInput', true, true, 'connected'],
      );
    });

    it('F-2305: the question closes for every window once it is answered', async () => {
      const first = await window('locked');
      const second = await window('locked');
      const waiting = first.connection.connect(new AbortController().signal);
      await eventually(() =>
        first.notices.some(notice => notice.type === 'prompt'),
      );
      const prompt = first.notices.find(notice => notice.type === 'prompt');
      if (prompt?.type === 'prompt') {
        await second.connection.answer(prompt.promptId, PASSPHRASE);
      }
      await waiting;
      const closed = await eventually(() =>
        first.notices.some(notice => notice.type === 'promptClosed'),
      );
      strictEqual(closed, true);
    });

    it('F-2305: the passphrase is kept in no record and no file the helper wrote', async () => {
      const {connection, notices} = await window('locked');
      const waiting = connection.connect(new AbortController().signal);
      await eventually(() => notices.some(notice => notice.type === 'prompt'));
      const prompt = notices.find(notice => notice.type === 'prompt');
      if (prompt?.type === 'prompt') {
        await connection.answer(prompt.promptId, PASSPHRASE);
      }
      await waiting;
      const leaked = readdirSync(windows.folder, {
        recursive: true,
        encoding: 'utf8',
      })
        .map(name => path.join(windows.folder, name))
        .filter(file => {
          try {
            return readFileSync(file, 'utf8').includes(PASSPHRASE);
          } catch {
            return false;
          }
        });
      deepStrictEqual(leaked, []);
    });
  });

  describe('F-2307 a host key that ssh does not know', () => {
    let counter = 0;

    /** A `Host` of its own that asks about host keys and has never seen this one. */
    function askingAlias(): string {
      counter += 1;
      const alias = `asking${String(counter)}`;
      host.appendConfig(
        `Host ${alias}\n  HostName 127.0.0.1\n  Port ${String(host.port)}\n  User harness\n  IdentityFile ${path.join(host.runFolder, 'id_ed25519')}\n  IdentitiesOnly yes\n  IdentityAgent none\n  StrictHostKeyChecking ask\n  ConnectTimeout 10\n  UserKnownHostsFile ${path.join(host.runFolder, `known_hosts_${alias}`)}\n`,
      );
      return alias;
    }

    async function asked(
      answer: string,
    ): Promise<{surface: string | undefined; outcome: ConnectOutcome}> {
      const alias = askingAlias();
      const {connection, notices} = await window(alias);
      const waiting = connection.connect(new AbortController().signal);
      await eventually(() => notices.some(notice => notice.type === 'prompt'));
      const prompt = notices.find(notice => notice.type === 'prompt');
      if (prompt?.type === 'prompt') {
        await connection.answer(prompt.promptId, answer);
      }
      const outcome = await waiting;
      await windows.kill(alias);
      return {
        surface: prompt?.type === 'prompt' ? prompt.surface : undefined,
        outcome,
      };
    }

    it('F-2307: the question is a pick of the fingerprint, and yes lets the login finish', async () => {
      const result = await asked('yes');
      deepStrictEqual(
        [result.surface, result.outcome.kind],
        ['fingerprintPick', 'connected'],
      );
    });

    it('F-2307: no refuses the host, as a rejected host key', async () => {
      const result = await asked('no');
      deepStrictEqual(
        result.outcome.kind === 'failed' &&
          result.outcome.failure.kind === 'loginFailed'
          ? result.outcome.failure.failure
          : result.outcome.kind,
        'hostKeyRejected',
      );
    });
  });
});
