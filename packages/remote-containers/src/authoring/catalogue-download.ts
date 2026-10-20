/**
 * @fileoverview The download of the catalogue over Node's own `http` and `https`, which the editor's extension host
 * patches to follow its proxy settings.
 */

import http from 'node:http';
import https from 'node:https';

/** How many redirects the download follows. */
const MAXIMUM_REDIRECTS = 5;

/** The text at `address`; it rejects with the cause in its message, and ends when `cancellation` aborts. */
export function downloadText(
  address: string,
  cancellation: AbortSignal,
  redirects = 0,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = address.startsWith('https:') ? https : http;
    const request = client.get(address, {signal: cancellation}, response => {
      const status = Number(response.statusCode);
      const {location} = response.headers;
      if (status >= 300 && status < 400 && location !== undefined) {
        response.resume();
        if (redirects >= MAXIMUM_REDIRECTS) {
          reject(new Error(`too many redirects from ${address}`));
          return;
        }
        downloadText(
          new URL(location, address).toString(),
          cancellation,
          redirects + 1,
        ).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`${address} answered ${String(status)}`));
        return;
      }
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}
