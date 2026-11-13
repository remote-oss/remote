import {createConnection} from 'node:net';
import {REQUEST} from '../windows/forward-support.ts';

/** The answer the local `port` gives to the client's first line, or nothing when nothing listens or it says nothing. */
export function greetingOf(port: number): Promise<string | undefined> {
  return new Promise(resolve => {
    const socket = createConnection({host: '127.0.0.1', port});
    const received: Buffer[] = [];
    socket.write(REQUEST);
    socket.setTimeout(2000, () => {
      socket.destroy();
    });
    socket.on('data', (chunk: Buffer) => received.push(chunk));
    socket.on('error', () => undefined);
    socket.on('close', () => {
      const text = Buffer.concat(received).toString().trim();
      resolve(text === '' ? undefined : text);
    });
  });
}
