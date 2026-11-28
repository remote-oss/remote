import {deepStrictEqual, rejects} from 'node:assert';
import {Duplex, PassThrough} from 'node:stream';
import {
  type Access,
  type LegOutcome,
  ProxyHandler,
  type TicketDesk,
} from '../../src/handler.ts';

const PROXY = {url: '', strictSsl: true, noProxy: []};
const ACCESS: Access = {token: 'gho_token', proxy: PROXY};
const ATTACH = {type: 'attach', token: 'gho_token', proxy: PROXY};

/** Legs that record what they were asked and answer as `outcome` says. */
function legsOf(outcome: (port: number) => LegOutcome) {
  const asked: Array<[string, number, Access]> = [];
  return {
    asked,
    legs: {
      stream(tunnelName: string, port: number, access: Access) {
        asked.push([tunnelName, port, access]);
        return Promise.resolve(outcome(port));
      },
    },
  };
}

/** A desk that hands out numbered tickets and keeps the streams. */
function deskOf(): TicketDesk & {streams: Duplex[]} {
  const streams: Duplex[] = [];
  return {
    address: '/run/rtd-0123456789abcdef.sock',
    streams,
    issue(stream: Duplex) {
      streams.push(stream);
      return String(streams.length).padStart(64, '0');
    },
  };
}

const STREAM: LegOutcome = {
  kind: 'stream',
  stream: Duplex.from({
    readable: new PassThrough(),
    writable: new PassThrough(),
  }),
};

describe("the local proxy's answers", () => {
  it('opens a stream with the latest sign-in and hands it out for a ticket on the data socket', async () => {
    const {legs, asked} = legsOf(() => STREAM);
    const desk = deskOf();
    const handler = new ProxyHandler(legs, desk);
    const attached = await handler.onRequest(ATTACH);
    await handler.onRequest({...ATTACH, token: 'gho_later'});
    const opened = await handler.onRequest({
      type: 'open',
      tunnelName: 'my-box',
      port: 31545,
    });
    deepStrictEqual(
      [attached, opened, asked, desk.streams.length],
      [
        {type: 'attached'},
        {type: 'opened', socket: desk.address, ticket: '1'.padStart(64, '0')},
        [['my-box', 31545, {...ACCESS, token: 'gho_later'}]],
        1,
      ],
    );
  });

  it('refuses a stream before any window has signed in, and asks the legs nothing', async () => {
    const {legs, asked} = legsOf(() => STREAM);
    const handler = new ProxyHandler(legs, deskOf());
    deepStrictEqual(
      [
        await handler.onRequest({type: 'open', tunnelName: 'my-box', port: 22}),
        asked,
      ],
      [
        {
          type: 'failed',
          reason: 'unauthorized',
          detail: 'no window has signed in to the proxy',
        },
        [],
      ],
    );
  });

  it('passes on a failure of the legs with its reason, and hands nothing out', async () => {
    const {legs} = legsOf(() => ({
      kind: 'failed',
      reason: 'notFound',
      detail: 'no tunnel my-box',
    }));
    const desk = deskOf();
    const handler = new ProxyHandler(legs, desk);
    await handler.onRequest(ATTACH);
    deepStrictEqual(
      [
        await handler.onRequest({type: 'open', tunnelName: 'my-box', port: 22}),
        desk.streams,
      ],
      [{type: 'failed', reason: 'notFound', detail: 'no tunnel my-box'}, []],
    );
  });

  it("keeps a tunnel's first serve result for the windows after it, and answers a later keep with the kept one", async () => {
    const handler = new ProxyHandler(legsOf(() => STREAM).legs, deskOf());
    deepStrictEqual(
      [
        await handler.onRequest({type: 'serveKept', tunnelName: 'my-box'}),
        await handler.onRequest({
          type: 'keepServe',
          tunnelName: 'my-box',
          served: {port: 8000},
        }),
        await handler.onRequest({
          type: 'keepServe',
          tunnelName: 'my-box',
          served: {port: 9000},
        }),
        await handler.onRequest({type: 'serveKept', tunnelName: 'my-box'}),
        await handler.onRequest({type: 'serveKept', tunnelName: 'other'}),
      ],
      [
        {type: 'serve', served: null},
        {type: 'accepted'},
        {type: 'serve', served: {port: 8000}},
        {type: 'serve', served: {port: 8000}},
        {type: 'serve', served: null},
      ],
    );
  });

  it('fails a body that is no request, and runs no end action', async () => {
    const handler = new ProxyHandler(legsOf(() => STREAM).legs, deskOf());
    await handler.runAction();
    await rejects(handler.onRequest({type: 'dance'}), /not a proxy request/);
  });
});
