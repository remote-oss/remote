import {deepStrictEqual, strictEqual} from 'node:assert';
import {FakeLocalPort} from 'lib-forwarding/testing/fake-network';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {openCliControl} from 'lib-server';
import {fakeCli, type Request} from 'lib-server/testing/fake-cli';
import {
  type CliBridge,
  type CliBridgeLoss,
  openCliBridge,
} from '../../src/cli/cli-bridge.ts';

const PORT = 41234;
const SERVE_PARAMS = {
  commit: 'c1',
  quality: 'insider',
  connectionToken: 'server-token',
  useLocalDownload: false,
};
const TEMPLATE_ERROR =
  'WrappedError(WrappedError { message: "cannot expand ${release} for commit c1 in the download url template", original: "t" })';

/** Lets the control client's decoder and the bridge's callbacks run: one turn of the event loop. */
async function settled(): Promise<void> {
  await new Promise(resolve => {
    setImmediate(resolve);
  });
}

/** A bridge over a fake CLI whose `serve` replies are held until the test answers them. */
async function bridgeOver(
  options: {answer?: 'serving' | 'held' | 'templateError'} = {},
) {
  const answer = options.answer ?? 'serving';
  const peer = fakeCli((request: Request) => {
    if (request.method !== 'serve' || answer === 'held') {
      return [];
    }
    return answer === 'serving'
      ? [{id: request.id, result: {}}]
      : [
          {
            id: null,
            method: 'serverlog',
            params: {line: 'Error installing server: cannot expand', level: 4},
          },
          {id: request.id, error: {code: -1, message: TEMPLATE_ERROR}},
        ];
  });
  const control = openCliControl(peer.stream);
  const local = new FakeLocalPort();
  const clock = new FakeClock();
  const losses: CliBridgeLoss[] = [];
  const logLines: string[] = [];
  const controlEnded: Array<() => void> = [];
  const bridge: CliBridge = await openCliBridge(
    control,
    SERVE_PARAMS,
    {
      onServeLog: line => logLines.push(line.text),
      onControlEnded: listener => controlEnded.push(listener),
    },
    {
      local,
      port: PORT,
      scheduler: clock.scheduler(),
      firstServeMilliseconds: 60_000,
      laterServeMilliseconds: 5_000,
    },
  );
  bridge.onLost(cause => losses.push(cause));
  return {peer, local, clock, bridge, losses, logLines, controlEnded};
}

/** The `serve` requests the fake CLI got, by socket id. */
function serveSocketIds(requests: readonly Request[]): unknown[] {
  return requests
    .filter(request => request.method === 'serve')
    .map(request => (request.params as {socket_id: number}).socket_id);
}

/** The bodies of the `servermsg` frames the fake CLI got for `socketId`, joined as text. */
function relayedText(requests: readonly Request[], socketId: number): string {
  return requests
    .filter(
      request =>
        request.method === 'servermsg' &&
        (request.params as {i: number}).i === socketId,
    )
    .map(request =>
      new TextDecoder().decode((request.params as {body: Uint8Array}).body),
    )
    .join('');
}

describe("the CLI path's local bridge", () => {
  it('F-2103 5.0 step 5: opening the bridge runs no serve', async () => {
    const {peer} = await bridgeOver();
    deepStrictEqual(serveSocketIds(peer.requests), []);
  });

  it('F-2103 5.0 step 6: the first connection runs serve on socket 0', async () => {
    const {peer, local} = await bridgeOver();
    local.accept(PORT);
    await settled();
    deepStrictEqual(serveSocketIds(peer.requests), [0]);
  });

  it('F-2103 5.0 step 6: serve carries the connection token of the server', async () => {
    const {peer, local} = await bridgeOver();
    local.accept(PORT);
    await settled();
    strictEqual(
      (
        peer.requests.find(request => request.method === 'serve')?.params as {
          connection_token: string;
        }
      ).connection_token,
      'server-token',
    );
  });

  it('§4a: a second connection runs its own serve on socket 1', async () => {
    const {peer, local} = await bridgeOver();
    local.accept(PORT);
    await settled();
    local.accept(PORT);
    await settled();
    deepStrictEqual(serveSocketIds(peer.requests), [0, 1]);
  });

  it('cli-03a: a connection that arrives while the first serve runs waits for it, then runs its own', async () => {
    const {peer, local} = await bridgeOver({answer: 'held'});
    local.accept(PORT);
    await settled();
    local.accept(PORT);
    await settled();
    const first = peer.requests.find(request => request.method === 'serve');
    peer.send({id: first?.id, result: {}});
    await settled();
    deepStrictEqual(serveSocketIds(peer.requests), [0, 1]);
  });

  it('cli-03a: a connection that arrives while the first serve runs is closed when that serve fails', async () => {
    const {peer, local, losses} = await bridgeOver({answer: 'held'});
    local.accept(PORT);
    await settled();
    const second = local.accept(PORT);
    let ended = false;
    second?.onClose(() => {
      ended = true;
    });
    await settled();
    const first = peer.requests.find(request => request.method === 'serve');
    peer.send({id: first?.id, error: {code: -1, message: TEMPLATE_ERROR}});
    await settled();
    deepStrictEqual([ended, losses.length], [true, 1]);
  });

  it('§4a: bytes sent before serve replied reach the CLI in order once it replies', async () => {
    const {peer, local} = await bridgeOver({answer: 'held'});
    const editor = local.accept(PORT);
    editor?.receive(new TextEncoder().encode('one'));
    editor?.receive(new TextEncoder().encode('two'));
    await settled();
    const serve = peer.requests.find(request => request.method === 'serve');
    peer.send({id: serve?.id, result: {}});
    await settled();
    strictEqual(relayedText(peer.requests, 0), 'onetwo');
  });

  it('§4a: bytes after serve reach the CLI as servermsg on their socket', async () => {
    const {peer, local} = await bridgeOver();
    const editor = local.accept(PORT);
    await settled();
    editor?.receive(new TextEncoder().encode('later'));
    strictEqual(relayedText(peer.requests, 0), 'later');
  });

  it('§4a: a servermsg for socket 1 reaches only the second connection', async () => {
    const {peer, local} = await bridgeOver();
    const first = local.accept(PORT);
    await settled();
    const second = local.accept(PORT);
    await settled();
    peer.send({
      id: null,
      method: 'servermsg',
      params: {i: 1, body: new TextEncoder().encode('to-two')},
    });
    await settled();
    deepStrictEqual(
      [first?.sent.length, new TextDecoder().decode(second?.sent[0])],
      [0, 'to-two'],
    );
  });

  it('§4a: serverclose for socket 0 ends the first connection', async () => {
    const {peer, local} = await bridgeOver();
    const editor = local.accept(PORT);
    await settled();
    let ended = false;
    editor?.onClose(() => {
      ended = true;
    });
    peer.send({id: null, method: 'serverclose', params: {i: 0}});
    await settled();
    strictEqual(ended, true);
  });

  it('§4a: a connection closed while its serve runs is not relayed when the serve replies', async () => {
    const {peer, local} = await bridgeOver({answer: 'held'});
    const editor = local.accept(PORT);
    editor?.receive(new TextEncoder().encode('early'));
    await settled();
    editor?.close();
    const serve = peer.requests.find(request => request.method === 'serve');
    peer.send({id: serve?.id, result: {}});
    await settled();
    strictEqual(relayedText(peer.requests, 0), '');
  });

  it('§4a: a bridge closed while a serve runs relays nothing when the serve replies', async () => {
    const {peer, local, bridge} = await bridgeOver({answer: 'held'});
    const editor = local.accept(PORT);
    editor?.receive(new TextEncoder().encode('early'));
    await settled();
    bridge.close();
    const serve = peer.requests.find(request => request.method === 'serve');
    peer.send({id: serve?.id, result: {}});
    await settled();
    strictEqual(relayedText(peer.requests, 0), '');
  });

  it('§4a: a connection the editor closed is no longer relayed', async () => {
    const {peer, local} = await bridgeOver();
    const editor = local.accept(PORT);
    await settled();
    editor?.close();
    peer.send({
      id: null,
      method: 'servermsg',
      params: {i: 0, body: new TextEncoder().encode('late')},
    });
    await settled();
    strictEqual(editor?.sent.length, 0);
  });

  it('F-2103 5.0 step 6: every serverlog line reaches the log', async () => {
    const {local, logLines} = await bridgeOver({answer: 'templateError'});
    local.accept(PORT);
    await settled();
    deepStrictEqual(logLines, ['Error installing server: cannot expand']);
  });

  it('themis on #431: a first serve that outlasts its bound ends the control connection', async () => {
    const {peer, local, clock} = await bridgeOver({answer: 'held'});
    local.accept(PORT);
    await settled();
    clock.advance(60_000);
    await settled();
    strictEqual(peer.closes(), 1);
  });

  it('themis on #431: the bound running out is a control loss', async () => {
    const {local, clock, losses} = await bridgeOver({answer: 'held'});
    local.accept(PORT);
    await settled();
    clock.advance(60_000);
    await settled();
    deepStrictEqual(losses, [{kind: 'controlClosed'}]);
  });

  it('themis on #431: a later serve has the shorter bound', async () => {
    const {peer, local, clock, losses} = await bridgeOver({answer: 'held'});
    local.accept(PORT);
    await settled();
    const serve = peer.requests.find(request => request.method === 'serve');
    peer.send({id: serve?.id, result: {}});
    await settled();
    local.accept(PORT);
    await settled();
    clock.advance(5_000);
    await settled();
    deepStrictEqual(losses, [{kind: 'controlClosed'}]);
  });

  it("athena on #458: a failed serve is a serve failure, with the CLI's error read", async () => {
    const {local, losses} = await bridgeOver({answer: 'templateError'});
    local.accept(PORT);
    await settled();
    strictEqual(
      losses[0]?.kind === 'serveFailed' && losses[0].error.kind,
      'template',
    );
  });

  it('athena on #458: a failed serve keeps the error line for the detail', async () => {
    const {local, losses} = await bridgeOver({answer: 'templateError'});
    local.accept(PORT);
    await settled();
    strictEqual(
      losses[0]?.kind === 'serveFailed' && losses[0].errorLine,
      'Error installing server: cannot expand',
    );
  });

  it('§6: a failed serve ends the connection that asked for it', async () => {
    const {local} = await bridgeOver({answer: 'templateError'});
    const editor = local.accept(PORT);
    let ended = false;
    editor?.onClose(() => {
      ended = true;
    });
    await settled();
    strictEqual(ended, true);
  });

  it('§6: two failures report one loss', async () => {
    const {local, losses} = await bridgeOver({answer: 'templateError'});
    local.accept(PORT);
    await settled();
    local.accept(PORT);
    await settled();
    strictEqual(losses.length, 1);
  });

  it('§W2: the control connection ending is a control loss', async () => {
    const {controlEnded, losses} = await bridgeOver();
    for (const listener of controlEnded) {
      listener();
    }
    deepStrictEqual(losses, [{kind: 'controlClosed'}]);
  });

  it('§W2: the listener failing is a control loss', async () => {
    const {local, losses} = await bridgeOver();
    local.fail(PORT, 'gone');
    deepStrictEqual(losses, [{kind: 'controlClosed'}]);
  });

  it('§4a: close stops the listener', async () => {
    const {local, bridge} = await bridgeOver();
    bridge.close();
    deepStrictEqual(local.closedPorts, [PORT]);
  });

  it('§4a: close ends the control connection', async () => {
    const {peer, bridge} = await bridgeOver();
    bridge.close();
    strictEqual(peer.closes(), 1);
  });

  it('§4a: close ends every relayed connection', async () => {
    const {local, bridge} = await bridgeOver();
    const editor = local.accept(PORT);
    await settled();
    let ended = false;
    editor?.onClose(() => {
      ended = true;
    });
    bridge.close();
    strictEqual(ended, true);
  });

  it('§4a: after close no loss is reported', async () => {
    const {controlEnded, bridge, losses} = await bridgeOver();
    bridge.close();
    for (const listener of controlEnded) {
      listener();
    }
    deepStrictEqual(losses, []);
  });

  it('§4a: closing twice ends the control connection once', async () => {
    const {peer, bridge} = await bridgeOver();
    bridge.close();
    bridge.close();
    strictEqual(peer.closes(), 1);
  });

  it('contracts S2: the bridge listens on the loopback', async () => {
    const {bridge} = await bridgeOver();
    deepStrictEqual(bridge.address, {host: '127.0.0.1', port: PORT});
  });
});
