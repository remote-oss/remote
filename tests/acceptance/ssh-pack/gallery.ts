import {createServer, type IncomingMessage, type Server} from 'node:http';

/** The port the stand-in gallery listens on; the ssh-pack launch's gallery variables name it. */
export const GALLERY_PORT = 23790;

/** One request the stand-in gallery received. */
export interface GalleryRequest {
  method: string;
  url: string;
  accept: string;
  contentType: string;
  body: string;
}

/** A running stand-in gallery and what it was asked. */
export interface StandInGallery {
  /** Every request received, in order. */
  requests(): readonly GalleryRequest[];
  stop(): Promise<void>;
}

/** The text of a request's body. */
async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Starts a gallery on the loopback that records every request it gets and answers each query with no extensions, so
 * that a row can read what the editor's command line asks of a gallery.
 */
export async function startGallery(): Promise<StandInGallery> {
  const seen: GalleryRequest[] = [];
  const server: Server = createServer((request, response) => {
    void bodyOf(request).then(body => {
      seen.push({
        method: request.method ?? '',
        url: request.url ?? '',
        accept: String(request.headers.accept ?? ''),
        contentType: String(request.headers['content-type'] ?? ''),
        body,
      });
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({results: [{extensions: [], resultMetadata: []}]}),
      );
    });
  });
  await new Promise<void>(resolve => {
    server.listen(GALLERY_PORT, '127.0.0.1', resolve);
  });
  return {
    requests: () => seen,
    stop: () =>
      new Promise<void>(resolve => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
