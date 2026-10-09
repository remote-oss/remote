import {deepStrictEqual} from 'node:assert';
import type {StartedServer} from 'lib-server';
import {
  createOpenWebUi,
  createServerPortRecord,
} from '../../src/surfaces/web-ui.ts';

function serverOn(port: number): StartedServer {
  return {port, processId: 1, connectionToken: 'token', reused: false};
}

function setup() {
  const record = createServerPortRecord();
  const opened: string[] = [];
  const command = createOpenWebUi(record, {
    openExternal: address => {
      opened.push(address);
      return Promise.resolve(undefined);
    },
  });
  return {record, opened, command};
}

describe('Open Web UI (F-2509)', () => {
  it('F-2509.BR-5: it opens the address of the server on the host loopback', async () => {
    const context = setup();
    context.record.remember(serverOn(41234));
    await context.command();
    deepStrictEqual(context.opened, ['http://localhost:41234/']);
  });

  it('F-2509.BR-5: with no server known it opens nothing', async () => {
    const context = setup();
    await context.command();
    deepStrictEqual(context.opened, []);
  });

  it('F-2509.BR-5: after a reconnect it opens the new port', async () => {
    const context = setup();
    context.record.remember(serverOn(41234));
    context.record.remember(serverOn(45678));
    await context.command();
    deepStrictEqual(context.opened, ['http://localhost:45678/']);
  });

  it('F-2509.BR-5: a connect that started no server forgets the port', async () => {
    const context = setup();
    context.record.remember(serverOn(41234));
    context.record.remember(undefined);
    await context.command();
    deepStrictEqual(context.opened, []);
  });

  it('F-2509.BR-6: running it twice opens the same address twice', async () => {
    const context = setup();
    context.record.remember(serverOn(41234));
    await context.command();
    await context.command();
    deepStrictEqual(context.opened, [
      'http://localhost:41234/',
      'http://localhost:41234/',
    ]);
  });

  it('F-2509.BR-6: a browser that refuses does not make the command fail', async () => {
    const record = createServerPortRecord();
    record.remember(serverOn(1));
    const command = createOpenWebUi(record, {
      openExternal: () => Promise.reject(new Error('no browser')),
    });
    deepStrictEqual(await command().then(() => 'done'), 'done');
  });
});
