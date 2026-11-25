/**
 * @fileoverview The relay's HTTPS service: it reads each request off the wire, hands it to the routes parsed, and writes
 * their answer as JSON with the `VsSaaS-Request-Id` header the clients record (`management/http_client.rs:345-362`).
 */

import {randomBytes} from 'node:crypto';
import {createServer, type Server} from 'node:https';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {problem, Refused, type Answer} from './problem.ts';
import {route, type RouteContext} from './routes.ts';

/** The most a request body may hold, in bytes: a tunnel with its ports and endpoints is far smaller. */
const BODY_LIMIT_BYTES = 1024 * 1024;

/** The HTTPS server of `context`, with the certificate and key given, not yet listening. */
export function relayServer(
  context: RouteContext,
  certificate: string | Buffer,
  key: string | Buffer,
): Server {
  return createServer({cert: certificate, key}, (request, response) => {
    void answerRequest(request, context).then(answer => {
      write(response, answer);
    });
  });
}

/**
 * The answer to `request`: the routes', a 400 for a request target that isn't a URL, or a 500 that names nothing of
 * the error when the routes throw; the error goes to the context's report. It never rejects.
 */
export async function answerRequest(
  request: IncomingMessage,
  context: RouteContext,
): Promise<Answer> {
  let url: URL;
  try {
    url = new URL(request.url ?? '/', 'https://relay.invalid');
  } catch {
    return problem(400, 'The request target is not valid.');
  }
  try {
    return await route(
      {
        method: request.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        headers: headersOf(request),
        readBody: () => bodyOf(request),
      },
      context,
    );
  } catch (error) {
    context.report(error);
    return problem(500, 'The relay failed.');
  }
}

/** The body of `request` as JSON, none when empty; one larger than the limit, or that isn't JSON, is refused. */
async function bodyOf(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > BODY_LIMIT_BYTES) {
      throw new Refused(problem(413, 'The body is too large.'));
    }
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return text === '' ? undefined : (JSON.parse(text) as unknown);
  } catch {
    throw new Refused(problem(400, 'The body is not JSON.'));
  }
}

function headersOf(
  request: IncomingMessage,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.join(', ') : value,
    ]),
  );
}

/** Writes `answer`, JSON when it has a body. */
export function write(response: ServerResponse, answer: Answer): void {
  response.statusCode = answer.status;
  response.setHeader('VsSaaS-Request-Id', randomBytes(8).toString('hex'));
  if (answer.body === undefined) {
    response.end();
    return;
  }
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(answer.body));
}
