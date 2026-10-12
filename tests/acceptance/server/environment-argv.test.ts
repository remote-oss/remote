import {deepStrictEqual} from 'node:assert';
import {createHash, randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {SharedSessionChannel, SshHostChannel} from 'lib-ssh';
import {startHost, type RunningHost} from './host-fixture.ts';
import {openSharedSession, type SharedSession} from './shared-session.ts';

type HostChannel = SshHostChannel | SharedSessionChannel;
type ScriptRequest = Parameters<HostChannel['runScript']>[0];

const SLEEP_SECONDS = 3;
const POLL_MILLISECONDS = 100;
const POLL_ATTEMPTS = 100;

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
  ): ScriptRequest {
    return {
      script,
      interpreter: 'posixShell',
      environment: {MARKER: token},
      input,
      cancellation: new AbortController().signal,
    };
  }

  /** Runs the script and lists the processes of the host and of the client while the script sleeps. */
  async function watched(
    channel: HostChannel,
    token: string,
    script: ScriptRequest,
  ): Promise<{hostLines: string[]; clientLines: string[]; status: number}> {
    const running = channel.runScript(script, () => undefined);
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
      if (
        host
          .onHost(
            'sh',
            '-c',
            `test -e ${receivedFile(token)} && echo yes || echo no`,
          )
          .trim() === 'yes'
      ) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, POLL_MILLISECONDS));
    }
    const hostLines = host.onHost('ps', '-o', 'args').split('\n');
    const clientLines = listProcesses(['ps', '-eo', 'args']);
    const outcome = await running;
    return {
      hostLines,
      clientLines,
      status: outcome.kind === 'exited' ? outcome.status : -1,
    };
  }

  function tokenOf(): string {
    return `marker-${randomBytes(8).toString('hex')}`;
  }

  function sleeping(token: string, readsInput: boolean): string {
    return `${readsInput ? 'cat >/dev/null; ' : ''}echo "$MARKER" >${receivedFile(token)}; sleep ${String(SLEEP_SECONDS)}; true`;
  }

  async function leaks(
    channel: HostChannel,
    input: ScriptRequest['input'],
  ): Promise<{hostLeaks: number; clientLeaks: number; received: string}> {
    const token = tokenOf();
    const seen = await watched(
      channel,
      token,
      request(
        token,
        sleeping(token, input.kind !== 'text' || input.text !== ''),
        input,
      ),
    );
    function count(lines: string[]): number {
      return lines.filter(line => line.includes(token)).length;
    }
    return {
      hostLeaks: count(seen.hostLines),
      clientLeaks: count(seen.clientLines),
      received:
        host.onHost('cat', receivedFile(token)).trim() === token
          ? 'the value'
          : 'something else',
    };
  }

  it('the shared session with a text input', async () => {
    deepStrictEqual(
      await leaks(session.channel, {kind: 'text', text: 'data'}),
      {hostLeaks: 0, clientLeaks: 0, received: 'the value'},
    );
  });

  it('the shared session without input', async () => {
    deepStrictEqual(await leaks(session.channel, {kind: 'text', text: ''}), {
      hostLeaks: 0,
      clientLeaks: 0,
      received: 'the value',
    });
  });

  it('the direct channel with a text input', async () => {
    deepStrictEqual(
      await leaks(host.channel, {kind: 'text', text: 'data\n\n'}),
      {hostLeaks: 0, clientLeaks: 0, received: 'the value'},
    );
  });

  it('the direct channel with a streamed file', async () => {
    const localFile = path.join(inputFolder, 'input.bin');
    writeFileSync(localFile, randomBytes(1000));
    deepStrictEqual(await leaks(host.channel, {kind: 'file', localFile}), {
      hostLeaks: 0,
      clientLeaks: 0,
      received: 'the value',
    });
  });

  it('the direct channel without input', async () => {
    deepStrictEqual(await leaks(host.channel, {kind: 'text', text: ''}), {
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
