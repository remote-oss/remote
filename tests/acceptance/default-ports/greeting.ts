import {createConnection} from 'node:net';

/** The greeting the local `port` gives, or nothing when nothing listens or it says nothing. */
export function greetingOf(port: number): Promise<string | undefined> {
  return new Promise(resolve => {
    const socket = createConnection({host: '127.0.0.1', port});
    const received: Buffer[] = [];
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
