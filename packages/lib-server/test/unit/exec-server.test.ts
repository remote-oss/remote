import {deepStrictEqual, rejects} from 'node:assert';
import {parseCliServeError} from '../../src/cli-path/cli-output.ts';
import {
  EXEC_FILE_TYPE,
  type ExecReadStream,
  type ExecSpawnedCommand,
  ExecServerFailure,
  execServerOf,
} from '../../src/cli-control/exec-server.ts';
import {
  announcing,
  connectedTo,
  failing,
  idOf,
  replying,
  settle,
  spawnWire,
  streamData,
  streamEnded,
  streaming,
} from '../../src/testing/fake-cli.ts';

const BYTES = new TextEncoder().encode('hello');

/** The bytes a read stream delivers, as text. */
function collect(stream: ExecReadStream): string[] {
  const seen: string[] = [];
  stream.onDidReceiveMessage(chunk => {
    seen.push(Buffer.from(chunk).toString());
  });
  return seen;
}

/** The failure `call` throws, or `undefined` when it does not throw. */
async function failureOf(
  call: Promise<unknown>,
): Promise<ExecServerFailure['failure'] | undefined> {
  try {
    await call;
    return undefined;
  } catch (error) {
    return error instanceof ExecServerFailure ? error.failure : undefined;
  }
}

/** A process the CLI announced the streams of, and the CLI's end. */
async function spawned(): Promise<{
  peer: ReturnType<typeof connectedTo>['peer'];
  process: ExecSpawnedCommand;
}> {
  const {peer, control} = connectedTo({spawn: announcing([1, 2, 3])});
  return {peer, process: await execServerOf(control).spawn('cat', [])};
}

describe('the exec server over the control connection', () => {
  describe('env', () => {
    it('F-2103 BR-10: gives the host environment, platform and release', async () => {
      const {control} = connectedTo({
        get_env: replying({
          env: {HOME: '/root'},
          os_platform: 'linux',
          os_release: '6.1',
        }),
      });
      deepStrictEqual(await execServerOf(control).env(), {
        env: {HOME: '/root'},
        osPlatform: 'linux',
        osRelease: '6.1',
      });
    });

    it('F-2103 BR-10: a reply of the wrong shape throws the malformed reply', async () => {
      const {control} = connectedTo({get_env: replying({})});
      deepStrictEqual(await failureOf(execServerOf(control).env()), {
        kind: 'malformedReply',
        method: 'get_env',
      });
    });
  });

  describe('kill', () => {
    it('F-2103 BR-10: kills the process through sys_kill', async () => {
      const {peer, control} = connectedTo({
        sys_kill: replying({success: true}),
      });
      await execServerOf(control).kill(42);
      // eslint-disable-next-line id-length -- the CLI's name for the parameter
      deepStrictEqual(peer.requests.at(-1)?.params, {pid: 42});
    });

    it('F-2103 BR-10: throws the failure of the call', async () => {
      const {control} = connectedTo({sys_kill: failing('no')});
      deepStrictEqual(await failureOf(execServerOf(control).kill(42)), {
        kind: 'callFailed',
        method: 'sys_kill',
        message: 'no',
      });
    });
  });

  describe('spawn', () => {
    it('F-2103 BR-10: passes the working folder and the environment of the options', async () => {
      const {peer, control} = connectedTo({spawn: announcing([1, 2, 3])});
      await execServerOf(control).spawn('echo', ['hi'], {
        cwd: '/w',
        env: {K: 'v'},
      });
      deepStrictEqual(
        peer.requests.at(-1)?.params,
        spawnWire('echo', ['hi'], {cwd: '/w', env: {K: 'v'}}),
      );
    });

    it('F-2103 BR-10: a spawn without options sends no working folder and an empty environment', async () => {
      const {peer, control} = connectedTo({spawn: announcing([1, 2, 3])});
      await execServerOf(control).spawn('echo', ['hi']);
      deepStrictEqual(
        peer.requests.at(-1)?.params,
        spawnWire('echo', ['hi'], {env: {}}),
      );
    });

    it('F-2103 BR-10: stdout and stderr deliver their bytes and stdin sends its own', async () => {
      const {peer, process} = await spawned();
      const outSeen = collect(process.stdout);
      const errSeen = collect(process.stderr);
      process.stdin.write(BYTES);
      peer.send(streamData(2, BYTES), streamData(3, BYTES));
      await settle();
      deepStrictEqual(
        [peer.requests.at(-1)?.params, outSeen, errSeen],
        [{segment: BYTES, stream: 1}, ['hello'], ['hello']],
      );
    });

    it('F-2103 BR-10: ending stdin sends the end of stream one', async () => {
      const {peer, process} = await spawned();
      process.stdin.end();
      deepStrictEqual(peer.requests.at(-1), {
        method: 'stream_ended',
        params: {stream: 1},
      });
    });

    it('F-2103 BR-10: a listener that was disposed hears nothing more, and another still does', async () => {
      const {peer, process} = await spawned();
      const dropped: string[] = [];
      const kept: string[] = [];
      process.stdout
        .onDidReceiveMessage(chunk =>
          dropped.push(Buffer.from(chunk).toString()),
        )
        .dispose();
      process.stdout.onDidReceiveMessage(chunk =>
        kept.push(Buffer.from(chunk).toString()),
      );
      peer.send(streamData(2, BYTES));
      await settle();
      deepStrictEqual([dropped, kept], [[], ['hello']]);
    });

    it('F-2103 BR-10: stdout ends when the CLI ends the stream', async () => {
      const {peer, process} = await spawned();
      peer.send(streamEnded(2));
      deepStrictEqual(await process.stdout.onEnd.then(() => 'ended'), 'ended');
    });

    it('F-2103 BR-10: onExit gives the status and the message', async () => {
      const {peer, process} = await spawned();
      peer.send({
        id: idOf(peer.requests.at(-1) ?? {}),
        result: {message: 'Exited', exit_code: 4},
      });
      deepStrictEqual(await process.onExit, {status: 4, message: 'Exited'});
    });

    it('F-2103 BR-10: onExit rejects with the failure when the exit reply is an error', async () => {
      const {peer, process} = await spawned();
      peer.send({
        id: idOf(peer.requests.at(-1) ?? {}),
        error: {code: -1, message: 'ProcessSpawnFailed'},
      });
      await rejects(process.onExit, ExecServerFailure);
    });

    it('F-2103 BR-10: a spawn that fails throws the failure', async () => {
      const {control} = connectedTo({spawn: failing('unauthorized')});
      deepStrictEqual(await failureOf(execServerOf(control).spawn('x', [])), {
        kind: 'callFailed',
        method: 'spawn',
        message: 'unauthorized',
      });
    });
  });

  describe('tcpConnect', () => {
    it('F-2103 BR-10: connects through net_connect and gives a duplex stream', async () => {
      const {peer, control} = connectedTo({net_connect: announcing([7])});
      const connection = await execServerOf(control).tcpConnect(
        '127.0.0.1',
        22,
      );
      const seen = collect(connection.stream);
      connection.stream.write(BYTES);
      peer.send(streamData(7, BYTES));
      await settle();
      deepStrictEqual(
        [peer.requests.at(-2)?.params, peer.requests.at(-1)?.params, seen],
        [{host: '127.0.0.1', port: 22}, {segment: BYTES, stream: 7}, ['hello']],
      );
    });

    it('F-2103 BR-10: done settles when the CLI replies', async () => {
      const {control} = connectedTo({net_connect: streaming([7], {})});
      const connection = await execServerOf(control).tcpConnect('h', 1);
      deepStrictEqual(await connection.done.then(() => 'done'), 'done');
    });

    it('F-2103 BR-10: done rejects when the connection failed, and an unobserved rejection ends nothing', async () => {
      const {control} = connectedTo({
        net_connect: request => [
          ...announcing([7])(request),
          ...failing('could not connect to address')(request),
        ],
      });
      const connection = await execServerOf(control).tcpConnect('h', 1);
      await settle();
      await rejects(connection.done, ExecServerFailure);
    });

    it('F-2103 BR-10: a connect that fails before its stream opened throws the failure', async () => {
      const {control} = connectedTo({net_connect: failing('bad')});
      deepStrictEqual(
        await failureOf(execServerOf(control).tcpConnect('h', 1)),
        {
          kind: 'callFailed',
          method: 'net_connect',
          message: 'bad',
        },
      );
    });
  });

  describe('fs', () => {
    it('F-2103 BR-10: stat gives the type and the size, with no times', async () => {
      const {control} = connectedTo({
        fs_stat: replying({exists: true, size: 9, type: 'dir'}),
      });
      deepStrictEqual(await execServerOf(control).fs.stat('/d'), {
        type: EXEC_FILE_TYPE.directory,
        ctime: 0,
        mtime: 0,
        size: 9,
      });
    });

    it('F-2103 BR-10: stat of a file is the file type', async () => {
      const {control} = connectedTo({
        fs_stat: replying({exists: true, size: 1, type: 'file'}),
      });
      deepStrictEqual(
        (await execServerOf(control).fs.stat('/f')).type,
        EXEC_FILE_TYPE.file,
      );
    });

    it('F-2103 BR-10: stat of a link is the symbolic link type', async () => {
      const {control} = connectedTo({
        fs_stat: replying({exists: true, size: 1, type: 'link'}),
      });
      deepStrictEqual(
        (await execServerOf(control).fs.stat('/l')).type,
        EXEC_FILE_TYPE.symbolicLink,
      );
    });

    it('F-2103 BR-10: stat with no kind and no size is the unknown type and size zero', async () => {
      const {control} = connectedTo({fs_stat: replying({exists: true})});
      deepStrictEqual(await execServerOf(control).fs.stat('/u'), {
        type: EXEC_FILE_TYPE.unknown,
        ctime: 0,
        mtime: 0,
        size: 0,
      });
    });

    it('F-2103 BR-10: stat of a path that does not exist throws', async () => {
      const {control} = connectedTo({fs_stat: replying({exists: false})});
      deepStrictEqual(await failureOf(execServerOf(control).fs.stat('/n')), {
        kind: 'callFailed',
        method: 'fs_stat',
        message: 'file not found',
      });
    });

    it('F-2103 BR-10: mkdirp, rm and rename send their calls', async () => {
      const {peer, control} = connectedTo({
        fs_mkdirp: replying({}),
        fs_rm: replying({}),
        fs_rename: replying({}),
      });
      const files = execServerOf(control).fs;
      await files.mkdirp('/a');
      await files.rm('/a');
      await files.rename('/a', '/b');
      deepStrictEqual(
        peer.requests.map(request => [request.method, request.params]),
        [
          ['fs_mkdirp', {path: '/a'}],
          ['fs_rm', {path: '/a'}],
          ['fs_rename', {from_path: '/a', to_path: '/b'}],
        ],
      );
    });

    it('F-2103 BR-10: readdir gives the names with their types', async () => {
      const {control} = connectedTo({
        fs_readdir: replying({
          contents: [
            {name: 'a', type: 'file'},
            {name: 'b', type: 'dir'},
            {name: 'c', type: null},
          ],
        }),
      });
      deepStrictEqual(await execServerOf(control).fs.readdir('/d'), [
        {name: 'a', type: EXEC_FILE_TYPE.file},
        {name: 'b', type: EXEC_FILE_TYPE.directory},
        {name: 'c', type: EXEC_FILE_TYPE.unknown},
      ]);
    });

    it('F-2103 BR-10: read delivers the bytes and ends when the call is done', async () => {
      const {peer, control} = connectedTo({fs_read: announcing([4])});
      const reading = await execServerOf(control).fs.read('/f');
      const seen = collect(reading);
      peer.send(streamData(4, BYTES), streamEnded(4), {
        id: idOf(peer.requests.at(-1) ?? {}),
        result: {},
      });
      await reading.onEnd;
      deepStrictEqual(seen, ['hello']);
    });

    it('F-2103 BR-10: read rejects its end with the failure when the call failed', async () => {
      const {peer, control} = connectedTo({fs_read: announcing([4])});
      const reading = await execServerOf(control).fs.read('/f');
      peer.send(streamEnded(4), {
        id: idOf(peer.requests.at(-1) ?? {}),
        error: {code: -1, message: 'file not found'},
      });
      await rejects(reading.onEnd, ExecServerFailure);
    });

    it('F-2103 BR-10: write sends the bytes, and done settles when the call is done', async () => {
      const {peer, control} = connectedTo({fs_write: announcing([5])});
      const writing = await execServerOf(control).fs.write('/f');
      writing.stream.write(BYTES);
      writing.stream.end();
      peer.send({id: idOf(peer.requests.at(-3) ?? {}), result: {}});
      await writing.done;
      deepStrictEqual(
        peer.requests.slice(-2).map(request => request.method),
        ['stream_data', 'stream_ended'],
      );
    });

    it('F-2103 BR-10: connect gives a duplex stream to the socket', async () => {
      const {peer, control} = connectedTo({fs_connect: streaming([6], {})});
      const connection = await execServerOf(control).fs.connect('/s');
      const seen = collect(connection.stream);
      peer.send(streamData(6, BYTES));
      await connection.done;
      await settle();
      deepStrictEqual(
        [peer.requests.at(-1)?.params, seen],
        [{path: '/s'}, ['hello']],
      );
    });
  });

  describe('failures', () => {
    it('F-2103 BR-10: a closed connection throws closed', async () => {
      const {peer, control} = connectedTo({});
      peer.end();
      await settle();
      deepStrictEqual(await failureOf(execServerOf(control).env()), {
        kind: 'closed',
      });
    });

    it('F-2103 BR-10: a closed connection says so in the message', () => {
      const failure = new ExecServerFailure({kind: 'closed'});
      deepStrictEqual(
        failure.message,
        'the control connection to the command-line program is closed',
      );
    });

    it('F-2103 BR-10: a failed call names its method and the CLI message', () => {
      deepStrictEqual(
        new ExecServerFailure({
          kind: 'callFailed',
          method: 'fs_rm',
          message: 'x',
        }).message,
        'fs_rm failed: x',
      );
    });

    it('F-2103 BR-10: a malformed reply names its method', () => {
      deepStrictEqual(
        new ExecServerFailure({kind: 'malformedReply', method: 'fs_rm'})
          .message,
        'the reply to fs_rm is not what it returns',
      );
    });

    it('F-2103 BR-10: a refused challenge carries the CLI message', () => {
      deepStrictEqual(
        new ExecServerFailure({kind: 'challengeRefused', message: 'no'})
          .message,
        'the challenge was refused: no',
      );
    });

    it('F-2103 BR-10: a failed serve carries the CLI message', () => {
      deepStrictEqual(
        new ExecServerFailure({
          kind: 'serveFailed',
          error: parseCliServeError('boom'),
          message: 'boom',
          errorLine: undefined,
        }).message,
        'serve failed: boom',
      );
    });
  });
});
