import {deepStrictEqual, strictEqual} from 'node:assert';
import type {HostChannel, ScriptRequest} from 'lib-host';
import {RecordingChannel} from 'lib-host/testing/recording-channel';
import {loggedChannel} from '../../src/pipeline/remote-log.ts';

const TOKEN = 'tok3nValue42';

/** A run request with `environment`. */
function requestWith(
  environment: Readonly<Record<string, string>> = {},
): ScriptRequest {
  return {
    script: 'install',
    interpreter: 'posixShell',
    environment,
    input: {kind: 'text', text: ''},
    cancellation: new AbortController().signal,
  };
}

/** A channel whose runs print `runs`' lines in turn, each run once. */
function channelPrinting(...runs: Array<readonly string[]>): RecordingChannel {
  return new RecordingChannel({
    identity: 'dev',
    platformHint: 'linux',
    scripts: runs.map(lines => ({
      interpreter: 'posixShell',
      matches: () => true,
      lines,
      ending: {kind: 'exit', status: 0},
    })),
  });
}

/** Runs each request over the logged `channel`, and gives the lines it logged and the lines each run's reader got. */
async function runsOf(
  channel: HostChannel,
  ...requests: ScriptRequest[]
): Promise<{written: string[]; read: string[][]}> {
  const written: string[] = [];
  const logged = loggedChannel(channel, {info: line => written.push(line)});
  const read: string[][] = [];
  for (const request of requests) {
    const lines: string[] = [];
    await logged.runScript(request, line => lines.push(line));
    read.push(lines);
  }
  return {written, read};
}

/** A result block with `facts`, as the scripts print it. */
function block(...facts: string[]): string[] {
  return [
    'remote-oss-server-result-begin',
    ...facts,
    'status=Ok',
    'remote-oss-server-result-end',
  ];
}

describe('the remote output in the log (card connect-67)', () => {
  it('F-2003 BR-6 item 8: every line of a run is logged as remote output, then handed on unchanged', async () => {
    const lines = ['a', 'remote-oss-server-progress unpack 40', ''];
    deepStrictEqual(await runsOf(channelPrinting(lines), requestWith()), {
      written: ['[remote] a', '[remote] remote-oss-server-progress unpack 40'],
      read: [lines],
    });
  });

  it('F-2003 BR-14: the token and the run’s environment values are scrubbed', async () => {
    const {written} = await runsOf(
      channelPrinting(block(`server.token=${TOKEN}`), [
        `listening with ${TOKEN}`,
        'agent at abcdefgh12 and short1z',
      ]),
      requestWith(),
      requestWith({SECRET_ONE: 'abcdefgh12', SHORT_ONE: 'short1z'}),
    );
    deepStrictEqual(written, [
      'Server result: Ok',
      '[remote] listening with aaa1aaaaaa11',
      '[remote] agent at ${SECRET_ONE} and short1z',
    ]);
  });

  it('F-2003 BR-14: an address keeps its scheme, host and path, and loses its user, password, query and fragment', async () => {
    const {written} = await runsOf(
      channelPrinting([
        'fetching https://u:p@host/path/x.tar.gz?token=abc123 now',
        "wget 'http://[::1:bad/x?token=abc123'",
        'see ftp://u2@mirror/y#frag',
      ]),
      requestWith(),
    );
    deepStrictEqual(written, [
      '[remote] fetching https://host/path/x.tar.gz now',
      "[remote] wget 'http://[::1:bad/x'",
      '[remote] see ftp://mirror/y',
    ]);
  });

  it('F-2003 BR-14: a value inside a longer one is named only as part of the longer one, whatever their order', async () => {
    const {written} = await runsOf(
      channelPrinting([
        'x abcdefgh-SECRETTAIL y',
        'GET https-free t=secretvalue1&u=PRIVATE99',
      ]),
      requestWith({
        SHORT_VALUE: 'abcdefgh',
        LONG_VALUE: 'abcdefgh-SECRETTAIL',
        INNER_VALUE: 'secretvalue1',
        OUTER_VALUE: 't=secretvalue1&u=PRIVATE99',
      }),
    );
    deepStrictEqual(written, [
      '[remote] x ${LONG_VALUE} y',
      '[remote] GET https-free ${OUTER_VALUE}',
    ]);
  });

  it('F-2003 BR-14: a value of exactly 8 characters is named', async () => {
    const {written} = await runsOf(
      channelPrinting(['agent abcdefgh']),
      requestWith({EIGHT_LONG: 'abcdefgh'}),
    );
    deepStrictEqual(written, ['[remote] agent ${EIGHT_LONG}']);
  });

  it('F-2003 BR-14: a later block with no token keeps the token learned before', async () => {
    const {written} = await runsOf(
      channelPrinting(block(`server.token=${TOKEN}`), [
        ...block(),
        `still ${TOKEN}`,
      ]),
      requestWith(),
      requestWith(),
    );
    deepStrictEqual(written, [
      'Server result: Ok',
      'Server result: Ok',
      '[remote] still aaa1aaaaaa11',
    ]);
  });

  it('F-2003 BR-6 item 8: the summary names a failed status as it is', async () => {
    const {written} = await runsOf(
      channelPrinting([
        'remote-oss-server-result-begin',
        'status=LinuxPrereqs',
        'remote-oss-server-result-end',
      ]),
      requestWith(),
    );
    deepStrictEqual(written, ['Server result: LinuxPrereqs']);
  });

  it('ADR-0010 rule 1: a line that only contains a marker is remote output, not a block', async () => {
    const {written} = await runsOf(
      channelPrinting(['say remote-oss-server-result-begin here', 'after']),
      requestWith(),
    );
    deepStrictEqual(written, [
      '[remote] say remote-oss-server-result-begin here',
      '[remote] after',
    ]);
  });

  it('ADR-0010 rule 1: a remote line that looks like ours changes nothing', async () => {
    const lines = [
      'remote-oss-server-result-begin',
      'from a startup file',
      ...block('server.port=41234'),
      'after',
    ];
    const {written, read} = await runsOf(channelPrinting(lines), requestWith());
    deepStrictEqual(
      {written, read},
      {
        written: ['Server result: Ok, port 41234', '[remote] after'],
        read: [lines],
      },
    );
  });

  it('F-2003 BR-14: the result block’s facts never reach the log', async () => {
    const {written} = await runsOf(
      channelPrinting([
        'a',
        ...block('host.display=:10', 'host.sshAuthSock=/tmp/ssh-x/agent.1'),
        'b',
      ]),
      requestWith(),
    );
    deepStrictEqual(written, ['[remote] a', 'Server result: Ok', '[remote] b']);
  });

  it('F-2003 BR-6 item 8: a block with no end keeps the rest of its run out of the written, and the next run logs again', async () => {
    const {written} = await runsOf(
      channelPrinting(
        ['a', 'remote-oss-server-result-begin', 'status=Ok', 'b'],
        ['c'],
      ),
      requestWith(),
      requestWith(),
    );
    deepStrictEqual(written, ['[remote] a', '[remote] c']);
  });

  it('F-2003 BR-6 item 8: a block without a status gives no summary', async () => {
    const {written} = await runsOf(
      channelPrinting([
        'remote-oss-server-result-begin',
        'server.port=1',
        'remote-oss-server-result-end',
      ]),
      requestWith(),
    );
    deepStrictEqual(written, []);
  });

  it('F-2003 BR-6 item 8: a carriage return ends a line as a newline does, and the reader still gets it', async () => {
    const lines = [
      'a\r',
      'remote-oss-server-result-begin\r',
      'status=Ok\r',
      'remote-oss-server-result-end\r',
    ];
    deepStrictEqual(await runsOf(channelPrinting(lines), requestWith()), {
      written: ['[remote] a', 'Server result: Ok'],
      read: [lines],
    });
  });

  it('F-2003 BR-6 item 8: the channel’s other operations are its own', async () => {
    const channel = new RecordingChannel({
      identity: 'dev',
      platformHint: 'linux',
      copies: [{matches: () => true, ending: {kind: 'copied'}}],
      hostPaths: new Map([['/tmp/a', '/host/a']]),
    });
    const logged = loggedChannel(channel, {info: () => undefined});
    deepStrictEqual(
      [
        logged.identity(),
        logged.platformHint(),
        await logged.copyToHost({
          localFile: '/tmp/a',
          remotePath: '/r/a',
          cancellation: new AbortController().signal,
        }),
        await logged.clientPathOnHost?.('/tmp/a'),
      ],
      ['dev', 'linux', {kind: 'copied'}, '/host/a'],
    );
  });

  it('F-2003 BR-6 item 8: a channel with no host path of client files still has none', async () => {
    const channel: HostChannel = {
      runScript: () => Promise.resolve({kind: 'exited', status: 0}),
      copyToHost: () => Promise.resolve({kind: 'copied'}),
      identity: () => 'dev',
      platformHint: () => 'linux',
    };
    strictEqual(
      await loggedChannel(channel, {info: () => undefined}).clientPathOnHost?.(
        '/tmp/a',
      ),
      undefined,
    );
  });
});
