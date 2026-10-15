import {deepStrictEqual} from 'node:assert';
import {systemCliPorts} from '../../src/cli/node-cli-ports.ts';

const OPTIONS: Parameters<typeof systemCliPorts.spawn>[2] = {
  shell: false,
  detached: true,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
};

describe('the system ports of the CLI host (card containers-04)', () => {
  it('C3: a program that runs gives its output and its exit status', async () => {
    const started = await systemCliPorts.spawn(
      process.execPath,
      ['-e', 'console.log("hi"); process.exitCode = 3'],
      OPTIONS,
    );
    if (started.kind !== 'spawned') {
      throw new Error('the program should start');
    }
    const printed: Buffer[] = [];
    started.process.stdout.on('data', (chunk: Buffer) => printed.push(chunk));
    deepStrictEqual(
      [await started.process.exited, Buffer.concat(printed).toString()],
      [3, 'hi\n'],
    );
  });

  it('C3: a program that is not there fails to start, with the system’s message', async () => {
    const started = await systemCliPorts.spawn(
      '/nonexistent/program',
      [],
      OPTIONS,
    );
    deepStrictEqual(
      started.kind === 'failed' ? started.message.includes('ENOENT') : started,
      true,
    );
  });

  it('C3: a signal to the group ends a program that leads one, and exits null', async () => {
    const started = await systemCliPorts.spawn(
      process.execPath,
      ['-e', 'setInterval(() => undefined, 1000)'],
      OPTIONS,
    );
    if (started.kind !== 'spawned' || started.process.processId === undefined) {
      throw new Error('the program should start');
    }
    systemCliPorts.killGroup(started.process.processId, 'SIGTERM');
    deepStrictEqual(await started.process.exited, null);
  });

  it('C3: a signal to a group that is gone throws', async () => {
    const started = await systemCliPorts.spawn(
      process.execPath,
      ['-e', ''],
      OPTIONS,
    );
    if (started.kind !== 'spawned' || started.process.processId === undefined) {
      throw new Error('the program should start');
    }
    const {processId} = started.process;
    await started.process.exited;
    let thrown = false;
    try {
      systemCliPorts.killGroup(processId, 'SIGKILL');
    } catch {
      thrown = true;
    }
    deepStrictEqual(thrown, true);
  });
});
