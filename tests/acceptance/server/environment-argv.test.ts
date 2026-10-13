import {deepStrictEqual} from 'node:assert';
import {createHash, randomBytes} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {SharedSessionChannel, SshHostChannel} from 'lib-ssh';
import {startHost, type RunningHost} from './host-fixture.ts';
import {openSharedSession, type SharedSession} from './shared-session.ts';

type HostChannel = SshHostChannel | SharedSessionChannel;
type ScriptRequest = Parameters<HostChannel['runScript']>[0];

const POLL_MILLISECONDS = 100;
const POLL_ATTEMPTS = 100;

/** How long the control's own child on the client lives: it must still run when the ps reads run. */
const LOCAL_CHILD_SECONDS = 30;

/** How many tenths of a second a script waits for its release before it ends anyway: a lost release can't hang the run. */
const RELEASE_TENTHS = 600;

/** Where on the host the test releases the script, once it has read the process lists. */
function releaseFile(token: string): string {
  return `/tmp/release-${fileId(token)}`;
}

/** The shell that waits on the host until the test releases the script, or the bound passes. */
function waitForRelease(token: string): string {
  return `n=0; while [ ! -e ${releaseFile(token)} ] && [ "$n" -lt ${String(RELEASE_TENTHS)} ]; do sleep 0.1; n=$((n + 1)); done`;
}

/** Where on the host the script writes the value it received. */
function receivedFile(token: string): string {
  return `/tmp/got-${fileId(token)}`;
}

/** A file name that does not hold the token: the token must be found only where the environment would put it. */
function fileId(token: string): string {
  return (
    token.length.toString(16) +
    createHash('sha256').update(token).digest('hex').slice(0, 12)
  );
}

function listProcesses(command: string[]): string[] {
  const [program = '', ...flags] = command;
  return spawnSync(program, flags, {encoding: 'utf8'}).stdout.split('\n');
}

describe('contracts §S10: a script environment is in no process command line, on the host and on the client', function () {
  this.timeout(180000);
  let host: RunningHost;
  let session: SharedSession;
  let inputFolder: string;

  before(async () => {
    host = await startHost();
    session = await openSharedSession(host);
    inputFolder = mkdtempSync(path.join(tmpdir(), 'environment-argv-'));
  });

  after(async () => {
    await session.stop();
    host.stop();
    rmSync(inputFolder, {recursive: true});
  });

  function request(
    token: string,
    script: string,
    input: ScriptRequest['input'],
    environment: Record<string, string> = {MARKER: token},
  ): ScriptRequest {
    return {
      script,
      interpreter: 'posixShell',
      environment,
      input,
      cancellation: new AbortController().signal,
    };
  }

  /** Runs the script and lists the processes of the host and of the client while the script waits, then releases it. */
  async function watched(
    channel: HostChannel,
    token: string,
    script: ScriptRequest,
  ): Promise<{
    hostLines: string[];
    clientLines: string[];
    status: number;
    ready: boolean;
  }> {
    const running = channel.runScript(script, () => undefined);
    let ready = false;
    for (let attempt = 0; attempt < POLL_ATTEMPTS && !ready; attempt++) {
      ready =
        host
          .onHost(
            'sh',
            '-c',
            `test -e ${receivedFile(token)} && echo yes || echo no`,
          )
          .trim() === 'yes';
      if (!ready) {
        await new Promise(resolve => setTimeout(resolve, POLL_MILLISECONDS));
      }
    }
    const hostLines = host.onHost('ps', '-o', 'args').split('\n');
    const clientLines = listProcesses(['ps', '-eo', 'args']);
    host.onHost('touch', releaseFile(token));
    const outcome = await running;
    return {
      hostLines,
      clientLines,
      status: outcome.kind === 'exited' ? outcome.status : -1,
      ready,
    };
  }

  function tokenOf(): string {
    return `marker-${randomBytes(8).toString('hex')}`;
  }

  function waiting(token: string, readsInput: boolean): string {
    return `${readsInput ? 'cat >/dev/null; ' : ''}echo "$MARKER" >${receivedFile(token)}; ${waitForRelease(token)}; true`;
  }

  /** The positive control's script: it reads its input, starts a child whose command line carries the marker, then waits for the release. */
  function controlScript(token: string): string {
    return `cat >/dev/null; echo "$MARKER" >${receivedFile(token)}; sh -c '${waitForRelease(token)}; true' ${token} & ${waitForRelease(token)}; true`;
  }

  async function leaks(
    channel: HostChannel,
    input: ScriptRequest['input'],
  ): Promise<{
    ready: boolean;
    hostLeaks: number;
    clientLeaks: number;
    received: string;
  }> {
    const token = tokenOf();
    const seen = await watched(
      channel,
      token,
      request(
        token,
        waiting(token, input.kind !== 'text' || input.text !== ''),
        input,
      ),
    );
    function count(lines: string[]): number {
      return lines.filter(line => line.includes(token)).length;
    }
    return {
      ready: seen.ready,
      hostLeaks: count(seen.hostLines),
      clientLeaks: count(seen.clientLines),
      received:
        host.onHost('cat', receivedFile(token)).trim() === token
          ? 'the value'
          : 'something else',
    };
  }

  it('positive control: a marker on the command line is found by the same ps reads on the host and the client', async () => {
    const token = tokenOf();
    const localChild = spawn(
      'sh',
      ['-c', `sleep ${String(LOCAL_CHILD_SECONDS)}; true`, token],
      {detached: true, stdio: 'ignore'},
    );
    localChild.unref();
    const seen = await watched(
      host.channel,
      token,
      request(token, controlScript(token), {kind: 'text', text: 'data'}, {}),
    );
    localChild.kill('SIGKILL');
    function count(lines: string[]): number {
      return lines.filter(line => line.includes(token)).length;
    }
    deepStrictEqual(
      [seen.ready, count(seen.hostLines) > 0, count(seen.clientLines) > 0],
      [true, true, true],
    );
  });

  it('the shared session with a text input', async () => {
    deepStrictEqual(
      await leaks(session.channel, {kind: 'text', text: 'data'}),
      {ready: true, hostLeaks: 0, clientLeaks: 0, received: 'the value'},
    );
  });

  it('the shared session without input', async () => {
    deepStrictEqual(await leaks(session.channel, {kind: 'text', text: ''}), {
      ready: true,
      hostLeaks: 0,
      clientLeaks: 0,
      received: 'the value',
    });
  });

  it('the direct channel with a text input', async () => {
    deepStrictEqual(
      await leaks(host.channel, {kind: 'text', text: 'data\n\n'}),
      {ready: true, hostLeaks: 0, clientLeaks: 0, received: 'the value'},
    );
  });

  it('the direct channel with a streamed file', async () => {
    const localFile = path.join(inputFolder, 'input.bin');
    writeFileSync(localFile, randomBytes(1000));
    deepStrictEqual(await leaks(host.channel, {kind: 'file', localFile}), {
      ready: true,
      hostLeaks: 0,
      clientLeaks: 0,
      received: 'the value',
    });
  });

  it('the direct channel without input', async () => {
    deepStrictEqual(await leaks(host.channel, {kind: 'text', text: ''}), {
      ready: true,
      hostLeaks: 0,
      clientLeaks: 0,
      received: 'the value',
    });
  });

  it('the direct channel delivers 64 KiB of random input byte for byte after the prelude', async () => {
    const token = tokenOf();
    const bytes = randomBytes(64 * 1024);
    const localFile = path.join(inputFolder, 'big.bin');
    writeFileSync(localFile, bytes);
    const target = `/tmp/copy-${fileId(token)}`;
    const outcome = await host.channel.runScript(
      request(token, `cat >${target}`, {kind: 'file', localFile}),
      () => undefined,
    );
    const sums = [
      host.onHost('sha256sum', target).split(' ')[0],
      createHash('sha256').update(bytes).digest('hex'),
    ];
    deepStrictEqual([outcome.kind, sums[0] === sums[1]], ['exited', true]);
  });
});
