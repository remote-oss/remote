import {deepStrictEqual} from 'node:assert';
import type {PlainData} from 'lib-helper';
import {readProxyReply, readProxyRequest} from '../../src/proxy/messages.ts';

const PROXY = {
  url: 'http://proxy:3128',
  strictSsl: true,
  noProxy: ['localhost'],
};
const TICKET = 'ab'.repeat(32);

describe('what a window asks of the local proxy', () => {
  it('reads each request it knows', () => {
    const requests: PlainData[] = [
      {type: 'attach', token: 'gho_token', proxy: PROXY},
      {type: 'open', tunnelName: 'my-box', port: 31545},
      {type: 'serveKept', tunnelName: 'my-box'},
      {type: 'keepServe', tunnelName: 'my-box', served: {port: 8000}},
    ];
    deepStrictEqual(
      requests.map(body => readProxyRequest(body)),
      requests,
    );
  });

  it('reads nothing from a body that is no request, or one with a field out of form', () => {
    deepStrictEqual(
      [
        null,
        'attach',
        {type: 'other'},
        {type: 'attach', token: '', proxy: PROXY},
        {type: 'attach', token: 't', proxy: 'none'},
        {type: 'attach', token: 't', proxy: {...PROXY, url: 3}},
        {type: 'attach', token: 't', proxy: {...PROXY, strictSsl: 'yes'}},
        {type: 'attach', token: 't', proxy: {...PROXY, noProxy: 'localhost'}},
        {type: 'attach', token: 't', proxy: {...PROXY, noProxy: [7]}},
        {type: 'open', tunnelName: '', port: 22},
        {type: 'open', tunnelName: 'b', port: 0},
        {type: 'open', tunnelName: 'b', port: 65536},
        {type: 'open', tunnelName: 'b', port: 1.5},
        {type: 'open', tunnelName: 'b', port: '22'},
        {type: 'serveKept', tunnelName: 7},
        {type: 'keepServe', tunnelName: 'b', served: null},
        {type: 'keepServe', tunnelName: 'b', served: [1]},
      ].map(body => readProxyRequest(body)),
      Array<undefined>(17).fill(undefined),
    );
  });
});

describe("the local proxy's replies", () => {
  it('reads each reply it knows', () => {
    const replies: PlainData[] = [
      {type: 'attached'},
      {type: 'accepted'},
      {
        type: 'opened',
        socket: '/run/rtd-0123456789abcdef.sock',
        ticket: TICKET,
      },
      {type: 'failed', reason: 'notFound', detail: 'no tunnel my-box'},
      {type: 'serve', served: null},
      {type: 'serve', served: {port: 8000}},
    ];
    deepStrictEqual(
      replies.map(body => readProxyReply(body)),
      replies,
    );
  });

  it('reads each reason a stream may fail for', () => {
    deepStrictEqual(
      ['notFound', 'refused', 'unreachable', 'unauthorized', 'limit'].map(
        reason => readProxyReply({type: 'failed', reason, detail: ''})?.type,
      ),
      ['failed', 'failed', 'failed', 'failed', 'failed'],
    );
  });

  it('reads nothing from a body that is no reply, or one with a field out of form', () => {
    deepStrictEqual(
      [
        null,
        {type: 'other'},
        {type: 'opened', socket: '', ticket: TICKET},
        {type: 'opened', socket: '/s', ticket: 'short'},
        {type: 'opened', socket: '/s', ticket: 7},
        {type: 'failed', reason: 'because', detail: ''},
        {type: 'failed', reason: 7, detail: ''},
        {type: 'failed', reason: 'limit'},
        {type: 'serve', served: 'yes'},
      ].map(body => readProxyReply(body)),
      Array<undefined>(9).fill(undefined),
    );
  });
});
