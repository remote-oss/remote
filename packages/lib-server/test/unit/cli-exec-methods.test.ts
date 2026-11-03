import {deepStrictEqual} from 'node:assert';
import type {ByteStream} from '../../src/cli-control/client.ts';
import type {
  CliConnection,
  CliSpawned,
} from '../../src/cli-control/control-methods.ts';
import {
  streamDataOf,
  streamEndedOf,
  streamsStartedOf,
} from '../../src/cli-control/rpc.ts';
import {
  announcing,
  connectedTo,
  failing,
  type FakeCli,
  idOf,
  replying,
  settle,
  streamData,
  streamEnded,
  spawnWire,
  streaming,
  streamsStarted,
} from '../../src/testing/fake-cli.ts';

/** The params of the last request the CLI read. */
function lastParams(peer: FakeCli): unknown {
  return peer.requests.at(-1)?.params;
}

/** The bytes a stream delivered, collected as text. */
function collect(stream: ByteStream): string[] {
  const seen: string[] = [];
  stream.onData(chunk => {
    seen.push(Buffer.from(chunk).toString());
  });
  return seen;
}

/** The connection a call opened, or its failure. */
async function opened(
  call: Promise<CliConnection | {kind: string}>,
): Promise<CliConnection> {
  return (await call) as CliConnection;
}

/** A duplex stream the CLI announced as stream five, and the CLI's end. */
async function connectedStream(): Promise<{
  peer: FakeCli;
  connection: CliConnection;
}> {
  const {peer, control} = connectedTo({net_connect: announcing([5])});
  return {peer, connection: await opened(control.netConnect('h', 1))};
}

/** A function that tells how often `stream` has closed. */
function closeCounter(stream: ByteStream): () => number {
  let closes = 0;
  stream.onClose(() => {
    closes += 1;
  });
  return () => closes;
}

/** A process the CLI announced the streams of, and the CLI's end. */
async function spawned(): Promise<{peer: FakeCli; process: CliSpawned}> {
  const {peer, control} = connectedTo({spawn: announcing([11, 12, 13])});
  const process = await started(
    control.spawn({command: 'cat', argumentList: []}),
  );
  return {peer, process};
}

/** The process a spawn started. */
async function started(
  call: Promise<CliSpawned | {kind: string}>,
): Promise<CliSpawned> {
  return (await call) as CliSpawned;
}

const BYTES = new TextEncoder().encode('hello');

describe('the control methods', () => {
  describe('sys_kill', () => {
    it('F-2103 BR-10: sends the process id', async () => {
      const {peer, control} = connectedTo({
        sys_kill: replying({success: true}),
      });
      await control.sysKill(7);
      // eslint-disable-next-line id-length -- the CLI's name for the parameter
      deepStrictEqual(lastParams(peer), {pid: 7});
    });

    it('F-2103 BR-10: gives whether the kill succeeded', async () => {
      const {control} = connectedTo({sys_kill: replying({success: false})});
      deepStrictEqual(await control.sysKill(7), {
        kind: 'killed',
        success: false,
      });
    });

    it('F-2103 BR-10: a reply without a success flag is a malformed reply', async () => {
      const {control} = connectedTo({sys_kill: replying({success: 'yes'})});
      deepStrictEqual(await control.sysKill(7), {
        kind: 'malformedReply',
        method: 'sys_kill',
      });
    });

    it('F-2103 BR-10: a reply that is not a map is a malformed reply', async () => {
      const {control} = connectedTo({sys_kill: replying(3)});
      deepStrictEqual(await control.sysKill(7), {
        kind: 'malformedReply',
        method: 'sys_kill',
      });
    });

    it('F-2103 BR-10: an error reply is a failed call with its message', async () => {
      const {control} = connectedTo({sys_kill: failing('no such process')});
      deepStrictEqual(await control.sysKill(7), {
        kind: 'callFailed',
        method: 'sys_kill',
        message: 'no such process',
      });
    });

    it('F-2103 BR-10: a call on an ended connection is closed', async () => {
      const {peer, control} = connectedTo({});
      peer.end();
      await settle();
      deepStrictEqual(await control.sysKill(7), {kind: 'closed'});
    });

    it('F-2103 BR-10: a call that the connection ending leaves unanswered is closed', async () => {
      const {peer, control} = connectedTo({});
      const call = control.sysKill(7);
      peer.end();
      deepStrictEqual(await call, {kind: 'closed'});
    });
  });

  describe('get_env', () => {
    const environment = {
      env: {PATH: '/usr/bin', HOME: '/root'},
      os_platform: 'linux',
      os_release: '6.1',
    };

    it('F-2103 BR-10: asks with no parameters', async () => {
      const {peer, control} = connectedTo({get_env: replying(environment)});
      await control.getEnv();
      deepStrictEqual(lastParams(peer), {});
    });

    it('F-2103 BR-10: gives the environment, the platform and the release', async () => {
      const {control} = connectedTo({get_env: replying(environment)});
      deepStrictEqual(await control.getEnv(), {
        kind: 'environment',
        environment: {
          env: {PATH: '/usr/bin', HOME: '/root'},
          platform: 'linux',
          release: '6.1',
        },
      });
    });

    it('F-2103 BR-10: a variable that is not text is a malformed reply', async () => {
      const {control} = connectedTo({
        get_env: replying({...environment, env: {PATH: 1}}),
      });
      deepStrictEqual(await control.getEnv(), {
        kind: 'malformedReply',
        method: 'get_env',
      });
    });

    it('F-2103 BR-10: a reply that is not a map is a malformed reply', async () => {
      const {control} = connectedTo({get_env: replying('x')});
      deepStrictEqual(await control.getEnv(), {
        kind: 'malformedReply',
        method: 'get_env',
      });
    });

    it('F-2103 BR-10: a reply without the environment map is a malformed reply', async () => {
      const {control} = connectedTo({
        get_env: replying({...environment, env: 'x'}),
      });
      deepStrictEqual(await control.getEnv(), {
        kind: 'malformedReply',
        method: 'get_env',
      });
    });

    it('F-2103 BR-10: a reply without the platform is a malformed reply', async () => {
      const {control} = connectedTo({
        get_env: replying({...environment, os_platform: 1}),
      });
      deepStrictEqual(await control.getEnv(), {
        kind: 'malformedReply',
        method: 'get_env',
      });
    });

    it('F-2103 BR-10: a reply without the release is a malformed reply', async () => {
      const {control} = connectedTo({
        get_env: replying({...environment, os_release: 1}),
      });
      deepStrictEqual(await control.getEnv(), {
        kind: 'malformedReply',
        method: 'get_env',
      });
    });
  });

  describe('fs_stat', () => {
    it('F-2103 BR-10: sends the path', async () => {
      const {peer, control} = connectedTo({fs_stat: replying({exists: false})});
      await control.fsStat('/a');
      deepStrictEqual(lastParams(peer), {path: '/a'});
    });

    it('F-2103 BR-10: gives the size and the kind of an entry that exists', async () => {
      const {control} = connectedTo({
        fs_stat: replying({exists: true, size: 12, type: 'file'}),
      });
      deepStrictEqual(await control.fsStat('/a'), {
        kind: 'stat',
        stat: {exists: true, size: 12, type: 'file'},
      });
    });

    it('F-2103 BR-10: a size and a kind that are nil are none', async () => {
      const {control} = connectedTo({
        fs_stat: replying({exists: false, size: null, type: null}),
      });
      deepStrictEqual(await control.fsStat('/a'), {
        kind: 'stat',
        stat: {exists: false, size: undefined, type: undefined},
      });
    });

    it('F-2103 BR-10: a size and a kind that are absent are none', async () => {
      const {control} = connectedTo({fs_stat: replying({exists: false})});
      deepStrictEqual(await control.fsStat('/a'), {
        kind: 'stat',
        stat: {exists: false, size: undefined, type: undefined},
      });
    });

    it('F-2103 BR-10: a reply that is not a map is a malformed reply', async () => {
      const {control} = connectedTo({fs_stat: replying(null)});
      deepStrictEqual(await control.fsStat('/a'), {
        kind: 'malformedReply',
        method: 'fs_stat',
      });
    });

    it('F-2103 BR-10: a reply without the exists flag is a malformed reply', async () => {
      const {control} = connectedTo({fs_stat: replying({exists: 1})});
      deepStrictEqual(await control.fsStat('/a'), {
        kind: 'malformedReply',
        method: 'fs_stat',
      });
    });

    it('F-2103 BR-10: a size that is not a number is a malformed reply', async () => {
      const {control} = connectedTo({
        fs_stat: replying({exists: true, size: 'big'}),
      });
      deepStrictEqual(await control.fsStat('/a'), {
        kind: 'malformedReply',
        method: 'fs_stat',
      });
    });

    it('F-2103 BR-10: a kind the CLI does not name is a malformed reply', async () => {
      const {control} = connectedTo({
        fs_stat: replying({exists: true, type: 'pipe'}),
      });
      deepStrictEqual(await control.fsStat('/a'), {
        kind: 'malformedReply',
        method: 'fs_stat',
      });
    });

    it('F-2103 BR-10: an error reply is a failed call', async () => {
      const {control} = connectedTo({fs_stat: failing('denied')});
      deepStrictEqual(await control.fsStat('/a'), {
        kind: 'callFailed',
        method: 'fs_stat',
        message: 'denied',
      });
    });
  });

  describe('fs_readdir', () => {
    it('F-2103 BR-10: sends the path', async () => {
      const {peer, control} = connectedTo({
        fs_readdir: replying({contents: []}),
      });
      await control.fsReaddir('/d');
      deepStrictEqual(lastParams(peer), {path: '/d'});
    });

    it('F-2103 BR-10: gives each entry with its name and kind', async () => {
      const {control} = connectedTo({
        fs_readdir: replying({
          contents: [
            {name: 'a', type: 'file'},
            {name: 'b', type: 'dir'},
            {name: 'c', type: 'link'},
            {name: 'd', type: null},
          ],
        }),
      });
      deepStrictEqual(await control.fsReaddir('/d'), {
        kind: 'entries',
        entries: [
          {name: 'a', type: 'file'},
          {name: 'b', type: 'dir'},
          {name: 'c', type: 'link'},
          {name: 'd', type: undefined},
        ],
      });
    });

    it('F-2103 BR-10: a reply that is not a map is a malformed reply', async () => {
      const {control} = connectedTo({fs_readdir: replying([])});
      deepStrictEqual(await control.fsReaddir('/d'), {
        kind: 'malformedReply',
        method: 'fs_readdir',
      });
    });

    it('F-2103 BR-10: a reply without the list is a malformed reply', async () => {
      const {control} = connectedTo({fs_readdir: replying({contents: 'x'})});
      deepStrictEqual(await control.fsReaddir('/d'), {
        kind: 'malformedReply',
        method: 'fs_readdir',
      });
    });

    it('F-2103 BR-10: an entry that is not a map is a malformed reply', async () => {
      const {control} = connectedTo({fs_readdir: replying({contents: ['a']})});
      deepStrictEqual(await control.fsReaddir('/d'), {
        kind: 'malformedReply',
        method: 'fs_readdir',
      });
    });

    it('F-2103 BR-10: an entry without a name is a malformed reply', async () => {
      const {control} = connectedTo({
        fs_readdir: replying({contents: [{name: 3}]}),
      });
      deepStrictEqual(await control.fsReaddir('/d'), {
        kind: 'malformedReply',
        method: 'fs_readdir',
      });
    });

    it('F-2103 BR-10: an entry with a kind the CLI does not name is a malformed reply', async () => {
      const {control} = connectedTo({
        fs_readdir: replying({contents: [{name: 'a', type: 'pipe'}]}),
      });
      deepStrictEqual(await control.fsReaddir('/d'), {
        kind: 'malformedReply',
        method: 'fs_readdir',
      });
    });

    it('F-2103 BR-10: an error reply is a failed call', async () => {
      const {control} = connectedTo({
        fs_readdir: failing('error listing directory'),
      });
      deepStrictEqual(await control.fsReaddir('/d'), {
        kind: 'callFailed',
        method: 'fs_readdir',
        message: 'error listing directory',
      });
    });
  });

  describe('fs_rm, fs_mkdirp and fs_rename', () => {
    it('F-2103 BR-10: fs_rm sends the path and is done on an empty result', async () => {
      const {peer, control} = connectedTo({fs_rm: replying({})});
      deepStrictEqual(
        [await control.fsRm('/x'), lastParams(peer)],
        [{kind: 'done'}, {path: '/x'}],
      );
    });

    it('F-2103 BR-10: fs_mkdirp sends the path and is done on an empty result', async () => {
      const {peer, control} = connectedTo({fs_mkdirp: replying({})});
      deepStrictEqual(
        [await control.fsMkdirp('/x'), lastParams(peer)],
        [{kind: 'done'}, {path: '/x'}],
      );
    });

    it('F-2103 BR-10: fs_rename sends both paths under the CLI names', async () => {
      const {peer, control} = connectedTo({fs_rename: replying({})});
      deepStrictEqual(
        [await control.fsRename('/a', '/b'), lastParams(peer)],
        [{kind: 'done'}, {from_path: '/a', to_path: '/b'}],
      );
    });

    it('F-2103 BR-10: a result that is not a map is a malformed reply', async () => {
      const {control} = connectedTo({fs_rm: replying(1)});
      deepStrictEqual(await control.fsRm('/x'), {
        kind: 'malformedReply',
        method: 'fs_rm',
      });
    });

    it('F-2103 BR-10: an error reply is a failed call', async () => {
      const {control} = connectedTo({
        fs_mkdirp: failing('error creating directory'),
      });
      deepStrictEqual(await control.fsMkdirp('/x'), {
        kind: 'callFailed',
        method: 'fs_mkdirp',
        message: 'error creating directory',
      });
    });
  });

  describe('the methods that open one duplex stream', () => {
    it('F-2103 BR-10: net_connect sends the host and the port', async () => {
      const {peer, control} = connectedTo({net_connect: announcing([5])});
      await control.netConnect('127.0.0.1', 80);
      deepStrictEqual(lastParams(peer), {host: '127.0.0.1', port: 80});
    });

    it('F-2103 BR-10: fs_read sends the path', async () => {
      const {peer, control} = connectedTo({fs_read: announcing([5])});
      await control.fsRead('/f');
      deepStrictEqual(lastParams(peer), {path: '/f'});
    });

    it('F-2103 BR-10: fs_write sends the path', async () => {
      const {peer, control} = connectedTo({fs_write: announcing([5])});
      await control.fsWrite('/f');
      deepStrictEqual(lastParams(peer), {path: '/f'});
    });

    it('F-2103 BR-10: fs_connect sends the path', async () => {
      const {peer, control} = connectedTo({fs_connect: announcing([5])});
      await control.fsConnect('/s');
      deepStrictEqual(lastParams(peer), {path: '/s'});
    });

    it('F-2103 BR-10: the call is done when the CLI replies with an empty result', async () => {
      const {control} = connectedTo({net_connect: streaming([5], {})});
      const connection = await opened(control.netConnect('h', 1));
      deepStrictEqual(await connection.done, {kind: 'done'});
    });

    it('F-2103 BR-10: a call whose result is not a map ends as a malformed reply', async () => {
      const {control} = connectedTo({net_connect: streaming([5], 1)});
      const connection = await opened(control.netConnect('h', 1));
      deepStrictEqual(await connection.done, {
        kind: 'malformedReply',
        method: 'net_connect',
      });
    });

    it('F-2103 BR-10: a call that fails after its stream opened ends as a failed call', async () => {
      const {control} = connectedTo({
        net_connect: request => [
          streamsStarted(idOf(request), [5]),
          ...failing('could not connect to address')(request),
        ],
      });
      const connection = await opened(control.netConnect('h', 1));
      deepStrictEqual(await connection.done, {
        kind: 'callFailed',
        method: 'net_connect',
        message: 'could not connect to address',
      });
    });

    it('F-2103 BR-10: a call that fails before its streams opened is a failed call', async () => {
      const {control} = connectedTo({net_connect: failing('bad parameters')});
      deepStrictEqual(await control.netConnect('h', 1), {
        kind: 'callFailed',
        method: 'net_connect',
        message: 'bad parameters',
      });
    });

    it('F-2103 BR-10: a call whose connection ended first is closed', async () => {
      const {peer, control} = connectedTo({});
      peer.end();
      await settle();
      deepStrictEqual(await control.netConnect('h', 1), {kind: 'closed'});
    });

    it('F-2103 BR-10: a call that the connection ending leaves before its streams were announced is closed', async () => {
      const {peer, control} = connectedTo({});
      const call = control.netConnect('h', 1);
      peer.end();
      deepStrictEqual(await call, {kind: 'closed'});
    });

    it('F-2103 BR-10: a call announcing the wrong number of streams is a malformed reply', async () => {
      const {control} = connectedTo({net_connect: announcing([5, 6])});
      deepStrictEqual(await control.netConnect('h', 1), {
        kind: 'malformedReply',
        method: 'net_connect',
      });
    });

    it('F-2103 BR-10: a call that the connection ending leaves announced but unanswered ends as closed', async () => {
      const {peer, connection} = await connectedStream();
      peer.end();
      deepStrictEqual(await connection.done, {kind: 'closed'});
    });
  });

  describe('the duplex streams', () => {
    it('F-2103 BR-10: bytes from the CLI reach the listener', async () => {
      const {peer, connection} = await connectedStream();
      const seen = collect(connection.stream);
      peer.send(streamData(5, BYTES));
      await settle();
      deepStrictEqual(seen, ['hello']);
    });

    it('F-2103 BR-10: bytes that arrive before the first listener are handed to it', async () => {
      const {peer, connection} = await connectedStream();
      peer.send(streamData(5, BYTES));
      await settle();
      deepStrictEqual(collect(connection.stream), ['hello']);
    });

    it('F-2103 BR-10: bytes go to the CLI as stream_data for the stream', async () => {
      const {peer, connection} = await connectedStream();
      connection.stream.send(BYTES);
      deepStrictEqual(peer.requests.at(-1), {
        method: 'stream_data',
        params: {segment: BYTES, stream: 5},
      });
    });

    it('F-2103 BR-10: sending reports whether the connection took the bytes', async () => {
      const {control} = connectedTo({net_connect: announcing([5])});
      const connection = await opened(control.netConnect('h', 1));
      deepStrictEqual(connection.stream.send(BYTES), true);
    });

    it('F-2103 BR-10: closing our end sends stream_ended for the stream', async () => {
      const {peer, connection} = await connectedStream();
      connection.stream.close();
      deepStrictEqual(peer.requests.at(-1), {
        method: 'stream_ended',
        params: {stream: 5},
      });
    });

    it('F-2103 BR-10: closing our end twice sends one end', async () => {
      const {peer, connection} = await connectedStream();
      connection.stream.close();
      connection.stream.close();
      deepStrictEqual(
        peer.requests.filter(request => request.method === 'stream_ended')
          .length,
        1,
      );
    });

    it('F-2103 BR-10: closing our end tells the close listeners', async () => {
      const {control} = connectedTo({net_connect: announcing([5])});
      const connection = await opened(control.netConnect('h', 1));
      const closes = closeCounter(connection.stream);
      connection.stream.close();
      deepStrictEqual(closes(), 1);
    });

    it('F-2103 BR-10: sending after our end is refused and sends nothing', async () => {
      const {peer, connection} = await connectedStream();
      connection.stream.close();
      const before = peer.requests.length;
      deepStrictEqual(
        [connection.stream.send(BYTES), peer.requests.length - before],
        [false, 0],
      );
    });

    it('F-2103 BR-10: the CLI ending its side closes ours', async () => {
      const {peer, connection} = await connectedStream();
      const closes = closeCounter(connection.stream);
      peer.send(streamEnded(5));
      await settle();
      deepStrictEqual(closes(), 1);
    });

    it('F-2103 BR-10: a listener added after the CLI ended its side hears the close at once', async () => {
      const {peer, connection} = await connectedStream();
      peer.send(streamEnded(5));
      await settle();
      const closes = closeCounter(connection.stream);
      deepStrictEqual(closes(), 1);
    });

    it('F-2103 BR-10: closing after the CLI ended its side sends nothing', async () => {
      const {peer, connection} = await connectedStream();
      peer.send(streamEnded(5));
      await settle();
      connection.stream.close();
      deepStrictEqual(
        peer.requests.filter(request => request.method === 'stream_ended')
          .length,
        0,
      );
    });

    it('F-2103 BR-10: bytes that arrive after the stream closed are dropped', async () => {
      const {peer, connection} = await connectedStream();
      const seen = collect(connection.stream);
      peer.send(streamEnded(5));
      peer.send(streamData(5, BYTES));
      await settle();
      deepStrictEqual(seen, []);
    });

    it('F-2103 BR-10: bytes and ends for a stream nobody opened are ignored', async () => {
      const {peer, connection} = await connectedStream();
      const seen = collect(connection.stream);
      peer.send(streamData(9, BYTES), streamEnded(9));
      await settle();
      deepStrictEqual(seen, []);
    });

    it('F-2103 BR-10: notifications with the wrong shape are ignored', async () => {
      const {peer, connection} = await connectedStream();
      const seen = collect(connection.stream);
      peer.send(
        {id: null, method: 'stream_data', params: {stream: 5, segment: 'text'}},
        {id: null, method: 'stream_ended', params: {}},
        {id: null, method: 'streams_started', params: {}},
      );
      await settle();
      deepStrictEqual(seen, []);
    });

    it('F-2103 BR-10: the connection ending closes every open stream', async () => {
      const {peer, process} = await spawned();
      const closed: string[] = [];
      process.stdin.onClose(() => closed.push('stdin'));
      process.stdout.onClose(() => closed.push('stdout'));
      process.stderr.onClose(() => closed.push('stderr'));
      peer.end();
      await settle();
      deepStrictEqual(closed, ['stdin', 'stdout', 'stderr']);
    });

    it('F-2103 BR-10: sending after the connection ended is refused', async () => {
      const {peer, connection} = await connectedStream();
      peer.end();
      await settle();
      deepStrictEqual(connection.stream.send(BYTES), false);
    });

    it('F-2103 BR-10: closing after the connection ended sends nothing', async () => {
      const {peer, connection} = await connectedStream();
      peer.end();
      await settle();
      const before = peer.requests.length;
      connection.stream.close();
      deepStrictEqual(peer.requests.length, before);
    });
  });

  describe('spawn', () => {
    it('F-2103 BR-10: sends the command, the arguments and the working folder, and the environment in its own parameter', async () => {
      const {peer, control} = connectedTo({spawn: announcing([11, 12, 13])});
      await control.spawn({
        command: 'echo',
        argumentList: ['a', 'b'],
        cwd: '/w',
        env: {TOKEN: 's3cret'},
      });
      deepStrictEqual(
        lastParams(peer),
        spawnWire('echo', ['a', 'b'], {cwd: '/w', env: {TOKEN: 's3cret'}}),
      );
    });

    it('R-26: the arguments are the arguments alone, and the environment is its own parameter', async () => {
      const {peer, control} = connectedTo({spawn: announcing([11, 12, 13])});
      await control.spawn({
        command: 'echo',
        argumentList: ['a'],
        env: {TOKEN: 's3cret'},
      });
      deepStrictEqual(
        lastParams(peer),
        spawnWire('echo', ['a'], {env: {TOKEN: 's3cret'}}),
      );
    });

    it('F-2103 BR-10: a spawn without options sends an empty environment', async () => {
      const {peer, control} = connectedTo({spawn: announcing([11, 12, 13])});
      await control.spawn({command: 'echo', argumentList: []});
      deepStrictEqual((lastParams(peer) as {env: unknown}).env, {});
    });

    it('F-2103 BR-10: stdin written reaches stream one, and stdout and stderr read are streams two and three', async () => {
      const {peer, process} = await spawned();
      const outSeen = collect(process.stdout);
      const errSeen = collect(process.stderr);
      process.stdin.send(BYTES);
      peer.send(streamData(12, new TextEncoder().encode('out')));
      peer.send(streamData(13, new TextEncoder().encode('err')));
      await settle();
      deepStrictEqual(
        [peer.requests.at(-1)?.params, outSeen, errSeen],
        [{segment: BYTES, stream: 11}, ['out'], ['err']],
      );
    });

    it('F-2103 BR-10: the exit is the exit code and the message of the reply', async () => {
      const {peer, process} = await spawned();
      peer.send({
        id: peer.requests.at(-1)?.id,
        result: {message: 'Exited', exit_code: 3},
      });
      deepStrictEqual(await process.exit, {
        kind: 'exited',
        exit: {exitCode: 3, message: 'Exited'},
      });
    });

    it('F-2103 BR-10: an exit reply of the wrong shape is a malformed reply', async () => {
      const {control} = connectedTo({
        spawn: streaming([11, 12, 13], {exit_code: 'x'}),
      });
      const process = await started(
        control.spawn({command: 'x', argumentList: []}),
      );
      deepStrictEqual(await process.exit, {
        kind: 'malformedReply',
        method: 'spawn',
      });
    });

    it('F-2103 BR-10: an exit reply that is an error is a failed call', async () => {
      const {peer, process} = await spawned();
      peer.send({
        id: peer.requests.at(-1)?.id,
        error: {code: -1, message: 'ProcessSpawnFailed'},
      });
      deepStrictEqual(await process.exit, {
        kind: 'callFailed',
        method: 'spawn',
        message: 'ProcessSpawnFailed',
      });
    });

    it('F-2103 BR-10: a spawn that fails before its streams opened is a failed call', async () => {
      const {control} = connectedTo({spawn: failing('unauthorized')});
      deepStrictEqual(await control.spawn({command: 'x', argumentList: []}), {
        kind: 'callFailed',
        method: 'spawn',
        message: 'unauthorized',
      });
    });

    it('F-2103 BR-10: a spawn announcing the wrong number of streams is a malformed reply', async () => {
      const {control} = connectedTo({spawn: announcing([11])});
      deepStrictEqual(await control.spawn({command: 'x', argumentList: []}), {
        kind: 'malformedReply',
        method: 'spawn',
      });
    });
  });

  describe('the notifications of streams', () => {
    it('F-2103 BR-10: streams_started gives the request and the ids', () => {
      deepStrictEqual(
        streamsStartedOf({for_request_id: 4, stream_ids: [1, 2]}),
        {
          requestId: 4,
          streamIds: [1, 2],
        },
      );
    });

    it('F-2103 BR-10: streams_started without a request is none', () => {
      deepStrictEqual(streamsStartedOf({stream_ids: [1]}), undefined);
    });

    it('F-2103 BR-10: streams_started with ids that are not numbers is none', () => {
      deepStrictEqual(
        streamsStartedOf({for_request_id: 4, stream_ids: ['a']}),
        undefined,
      );
    });

    it('F-2103 BR-10: streams_started without a list is none', () => {
      deepStrictEqual(
        streamsStartedOf({for_request_id: 4, stream_ids: 1}),
        undefined,
      );
    });

    it('F-2103 BR-10: stream_data gives the stream and the bytes', () => {
      deepStrictEqual(streamDataOf({stream: 2, segment: BYTES}), {
        stream: 2,
        segment: BYTES,
      });
    });

    it('F-2103 BR-10: stream_data without a stream is none', () => {
      deepStrictEqual(streamDataOf({segment: BYTES}), undefined);
    });

    it('F-2103 BR-10: stream_ended gives the stream', () => {
      deepStrictEqual(streamEndedOf({stream: 2}), 2);
    });

    it('F-2103 BR-10: stream_ended without a stream is none', () => {
      deepStrictEqual(streamEndedOf({}), undefined);
    });
  });
});
