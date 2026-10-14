/**
 * @fileoverview What the ports rows read back from the host: the port and address the server listens on, and
 * whether another machine of the run reaches the port.
 */

import {execFile} from 'node:child_process';
import {createConnection} from 'node:net';
import {promisify} from 'node:util';
import {onHost} from '../suite/harness.ts';

const execFileAsync = promisify(execFile);

/** The local address of a `LISTEN` line, and its program name, named when the host can name it. */
interface ListenLine {
  localAddress: string;
  program: string;
}

/** The `LISTEN` lines of `netstat` on the host, read as the user `harness`; with `programs` the program name too. */
async function listenLines(programs: boolean): Promise<ListenLine[]> {
  const output = await onHost('netstat', programs ? '-ltnp' : '-ltn');
  const lines: ListenLine[] = [];
  for (const line of output.split('\n')) {
    const fields = line
      .trim()
      .split(/\s+/)
      .filter(field => field !== '');
    if (fields.length < 6 || fields[5] !== 'LISTEN') {
      continue;
    }
    lines.push({
      localAddress: fields[3] ?? '',
      program: fields[6]?.split('/').pop() ?? '',
    });
  }
  return lines;
}

/**
 * The port the server listens on, read on the host: the local port of the one `LISTEN` line whose program is
 * `node`. It throws when there is no such line, or more than one. The log has no line with the port: nothing
 * writes F-2003's "Remote server listening on port" line yet.
 */
export async function serverPort(): Promise<number> {
  const lines = await listenLines(true);
  const serverLines = lines.filter(line => line.program === 'node');
  const serverLine = serverLines[0];
  if (serverLines.length !== 1 || serverLine === undefined) {
    throw new Error(
      `the host showed ${String(serverLines.length)} LISTEN lines of the node server, expected one`,
    );
  }
  const port = Number(serverLine.localAddress.split(':').pop());
  if (Number.isNaN(port)) {
    throw new Error(
      `the server's LISTEN line has no port: ${serverLine.localAddress}`,
    );
  }
  return port;
}

/**
 * The address the host listens on `port`: the address part of the local address of the `LISTEN` line that ends in
 * `:<port>`; `undefined` when there is none.
 */
export async function listenAddress(port: number): Promise<string | undefined> {
  const suffix = `:${String(port)}`;
  const line = (await listenLines(false)).find(candidate =>
    candidate.localAddress.endsWith(suffix),
  );
  if (line === undefined) {
    return undefined;
  }
  return line.localAddress.slice(0, line.localAddress.length - suffix.length);
}

/** The host container's own address on the run's network, the address of another machine for the host. */
export async function containerAddress(): Promise<string> {
  const container = process.env.HARNESS_CONTAINER;
  if (container === undefined || container === '') {
    throw new Error(
      'HARNESS_CONTAINER is not set; run the tests with pnpm test:acceptance',
    );
  }
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '-f',
    '{{range .NetworkSettings.Networks}}{{.IPAddress}}\n{{end}}',
    container,
  ]);
  return stdout.trim().split('\n')[0] ?? '';
}

/** Whether another machine of the run reaches `address` on `port` within five seconds, then drops the socket. */
export function reaches(address: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({host: address, port, timeout: 5000});
    function settle(reached: boolean): void {
      socket.destroy();
      resolve(reached);
    }
    socket.on('connect', () => {
      settle(true);
    });
    socket.on('timeout', () => {
      settle(false);
    });
    socket.on('error', () => {
      settle(false);
    });
  });
}
