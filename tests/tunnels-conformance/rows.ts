/**
 * @fileoverview The rows of the tunnels conformance run, in order. The stack's own row comes first: the relay answers
 * the run's listed account through the run's authority, so every later row starts from a stack that serves.
 */

import {readFileSync} from 'node:fs';
import {request} from 'node:https';
import type {ConformanceRow} from './conformance.ts';
import {TOKENS} from './identities.ts';
import {RUN_CLUSTER, type Stack} from './stack.ts';

/** The management API's version, which every request names. */
const API_VERSION = '2023-09-27-preview';

/** A relay answer: its status and its body, as text. */
interface RelayAnswer {
  status: number;
  body: string;
}

/** Sends `GET path` to the relay's control plane with `token`, trusting the run's authority alone. */
export function relayGet(
  stack: Stack,
  path: string,
  token: string,
): Promise<RelayAnswer> {
  const controlPlane = `cp.${stack.domain}`;
  return new Promise((resolve, reject) => {
    const sent = request(
      {
        host: stack.relayAddress,
        port: stack.relayPort,
        servername: controlPlane,
        // eslint-disable-next-line id-length -- the option's name in Node
        ca: readFileSync(stack.files.caFile),
        path: `${path}${path.includes('?') ? '&' : '?'}api-version=${API_VERSION}`,
        headers: {host: controlPlane, authorization: `github ${token}`},
      },
      response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve({status: response.statusCode ?? 0, body});
        });
      },
    );
    sent.on('error', reject);
    sent.end();
  });
}

/** Throws unless `answer` is a 200 listing of the caller's tunnels in the run's cluster. */
export function checkListing(answer: RelayAnswer): void {
  const listing =
    answer.status === 200
      ? (JSON.parse(answer.body) as {value?: Array<{clusterId?: string}>})
      : {};
  if (listing.value?.[0]?.clusterId !== RUN_CLUSTER) {
    throw new Error(
      `GET /tunnels answered ${String(answer.status)}: ${answer.body}`,
    );
  }
}

/** The run's rows. */
export const ROWS: readonly ConformanceRow[] = [
  {
    file: 'tunnels-conformance/rows.ts',
    title:
      'the stack: the relay lists the listed account’s tunnels in the run’s cluster, through the run’s authority',
    check: async stack => {
      checkListing(await relayGet(stack, '/tunnels', TOKENS.listed));
    },
  },
];
