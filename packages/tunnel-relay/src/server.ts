/**
 * @fileoverview The relay's HTTPS service: it reads each request off the wire, hands it to the routes parsed, and writes
 * their answer as JSON with the `VsSaaS-Request-Id` header the clients record (`management/http_client.rs:345-362`).
 */

import {randomBytes} from 'node:crypto';
import {createServer, type Server} from 'node:https';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {problem, type Answer} from './problem.ts';
import {route, type RouteContext} from './routes.ts';

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

/** The answer to `request`: the routes', a 400 for a body that is not JSON, or a 500 when the routes throw. */
export async function answerRequest(
  request: IncomingMessage,
  context: RouteContext,
): Promise<Answer> {
  const url = new URL(request.url ?? '/', 'https://relay.invalid');
  let body: unknown;
  try {
    body = await bodyOf(request);
  } catch {
    return problem(400, 'The body is not JSON.');
  }
  try {
    return await route(
      {
        method: request.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        headers: headersOf(request),
        body,
      },
      context,
    );
  } catch (error) {
    return problem(500, `The relay failed: ${String(error)}`);
  }
}

async function bodyOf(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? undefined : (JSON.parse(text) as unknown);
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
