/**
 * @fileoverview The client's download of a server archive on Node.js, for the tests that install a real server: the
 * download port of lib-server over `fetch`, with the bounds and the allowed hosts of its request, and the client's
 * files for the transfer.
 */

import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, rename, rm, stat} from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {
  ClientFilePort,
  DownloadPort,
  DownloadRequest,
  DownloadResult,
} from 'lib-server';

const MAXIMUM_REDIRECTS = 10;

/** The final response of a download, following redirects only through hosts the request allows. */
async function finalResponse(
  request: DownloadRequest,
): Promise<Response | {refused: string}> {
  let address = request.address;
  for (let redirects = 0; redirects <= MAXIMUM_REDIRECTS; redirects++) {
    if (!request.allowedHosts.includes(new URL(address).hostname)) {
      return {refused: `redirected to ${new URL(address).hostname}`};
    }
    const response = await fetch(address, {
      redirect: 'manual',
      signal: request.cancellation,
    });
    const next = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || next === null) {
      return response;
    }
    address = new URL(next, address).toString();
  }
  return {refused: 'too many redirects'};
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

/** The download port over `fetch`. */
export const fetchDownloadPort: DownloadPort = {
  download: async (request): Promise<DownloadResult> => {
    try {
      const response = await finalResponse(request);
      if ('refused' in response) {
        return {kind: 'failed', detail: response.refused};
      }
      if (!response.ok || response.body === null) {
        return {kind: 'failed', detail: `HTTP ${String(response.status)}`};
      }
      const length = response.headers.get('content-length');
      const announcedLength = length === null ? undefined : Number(length);
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
        finalAddress: response.url === '' ? request.address : response.url,
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

/** The SHA-256 of a file, as lower-case hex. */
export async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/** The client's files on this machine. */
export const nodeClientFiles: ClientFilePort = {
  remove: file => rm(file, {force: true}),
  exists: async file => {
    try {
      return (await stat(file)).isFile();
    } catch {
      return false;
    }
  },
  size: async file => (await stat(file)).size,
  sha256: sha256Of,
  rename: async (source, destination) => {
    try {
      await rename(source, destination);
      return {kind: 'renamed'};
    } catch (caught) {
      return {
        kind: 'failed',
        detail: caught instanceof Error ? caught.message : String(caught),
      };
    }
  },
};
