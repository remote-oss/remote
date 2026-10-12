/**
 * @fileoverview The client's download of a server archive: the download port of the library over an HTTP function the
 * caller gives, with the bounds and the allowed hosts of its request. The library makes no request of its own and
 * reads no proxy setting; the extension gives the editor's patched `fetch`, so the editor's proxy settings apply.
 */

import {createWriteStream} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {DownloadPort, DownloadRequest, DownloadResult} from './ports.ts';

/** The one HTTP call the download makes: a GET that follows no redirect by itself. */
export type HttpGet = (
  address: string,
  init: {redirect: 'manual'; signal: AbortSignal},
) => Promise<Response>;

const MAXIMUM_REDIRECTS = 10;

/** The final response of a download and the address it came from, following redirects only through allowed hosts. */
async function finalResponse(
  httpGet: HttpGet,
  request: DownloadRequest,
): Promise<{response: Response; address: string} | {refused: string}> {
  let address = request.address;
  for (let redirects = 0; redirects <= MAXIMUM_REDIRECTS; redirects++) {
    if (!request.allowedHosts.includes(new URL(address).hostname)) {
      return {refused: `redirected to ${new URL(address).hostname}`};
    }
    const response = await httpGet(address, {
      redirect: 'manual',
      signal: request.cancellation,
    });
    const next = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || next === null) {
      return {response, address};
    }
    await response.body?.cancel();
    // A redirect from https to http is not refused here; the library checks the final address.
    address = new URL(next, address).toString();
  }
  return {refused: 'too many redirects'};
}

/** The length a response announced, when the header is a plain number; any other text announces nothing. */
function announcedLengthOf(header: string | null): number | undefined {
  return header !== null && /^\d+$/.test(header) ? Number(header) : undefined;
}

/** Writes the body to the destination, ending it as `stalled` or `tooLarge` when the bounds say so. */
async function writeBody(
  body: ReadableStream<Uint8Array>,
  request: DownloadRequest,
  announcedLength: number | undefined,
): Promise<'done' | 'stalled' | 'tooLarge'> {
  await mkdir(path.dirname(request.destination), {recursive: true});
  const ceiling = announcedLength ?? request.maximumBytes;
  const stream = Readable.fromWeb(body as never);
  let received = 0;
  const state: {ending: 'done' | 'stalled' | 'tooLarge'} = {ending: 'done'};
  let stall: NodeJS.Timeout | undefined;
  function armStall(): void {
    clearTimeout(stall);
    stall = setTimeout(() => {
      state.ending = 'stalled';
      stream.destroy();
    }, request.stallMilliseconds);
  }
  armStall();
  stream.on('data', (chunk: Buffer) => {
    received += chunk.length;
    armStall();
    if (received > ceiling) {
      state.ending = 'tooLarge';
      stream.destroy();
    } else if (announcedLength !== undefined) {
      request.onPercent(Math.floor((received * 100) / announcedLength));
    }
  });
  try {
    await pipeline(stream, createWriteStream(request.destination));
  } catch (caught) {
    if (state.ending === 'done') {
      throw caught;
    }
  } finally {
    clearTimeout(stall);
  }
  return state.ending;
}

/** The download port over `httpGet`. */
export function downloadPortOf(httpGet: HttpGet): DownloadPort {
  return {
    download: async (request): Promise<DownloadResult> => {
      try {
        const final = await finalResponse(httpGet, request);
        if ('refused' in final) {
          return {kind: 'failed', detail: final.refused};
        }
        const {response} = final;
        if (!response.ok || response.body === null) {
          return {kind: 'failed', detail: `HTTP ${String(response.status)}`};
        }
        const announcedLength = announcedLengthOf(
          response.headers.get('content-length'),
        );
        const ending = await writeBody(response.body, request, announcedLength);
        if (ending !== 'done') {
          return {
            kind: 'failed',
            detail: ending,
            cause: ending,
          };
        }
        return {
          kind: 'downloaded',
          facts: announcedLength === undefined ? {} : {announcedLength},
          finalAddress: response.url === '' ? final.address : response.url,
        };
      } catch (caught) {
        return request.cancellation.aborted
          ? {kind: 'cancelled'}
          : {
              kind: 'failed',
              detail: caught instanceof Error ? caught.message : String(caught),
            };
      }
    },
  };
}
