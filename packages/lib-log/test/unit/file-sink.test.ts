import {deepStrictEqual} from 'node:assert';
import {createFileSink, type LogLine, plainLineOf} from '../../src/index.ts';

const FIRST: LogLine = {level: 'info', scope: [], message: 'first', time: 0};
const SECOND: LogLine = {level: 'info', scope: [], message: 'second', time: 1};

describe('file sink (card wsl-10)', () => {
  it('wsl-10: each line is appended in the plain format with a line end, in order', async () => {
    const appended: string[] = [];
    const sink = createFileSink({
      append: text => {
        appended.push(text);
        return Promise.resolve();
      },
      onFailure: () => undefined,
    });
    sink.write(FIRST);
    sink.write(SECOND);
    await new Promise(resolve => setTimeout(resolve, 0));
    deepStrictEqual(appended, [
      `${plainLineOf(FIRST)}\n`,
      `${plainLineOf(SECOND)}\n`,
    ]);
  });

  it('wsl-10: a slow append does not let the next line overtake it', async () => {
    const order: string[] = [];
    const sink = createFileSink({
      append: async text => {
        if (text.includes('first')) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        order.push(text.trim());
      },
      onFailure: () => undefined,
    });
    sink.write(FIRST);
    sink.write(SECOND);
    await new Promise(resolve => setTimeout(resolve, 60));
    deepStrictEqual(order, [plainLineOf(FIRST), plainLineOf(SECOND)]);
  });

  it('wsl-10: the named secrets are redacted from the file', async () => {
    const appended: string[] = [];
    const sink = createFileSink({
      append: text => {
        appended.push(text);
        return Promise.resolve();
      },
      onFailure: () => undefined,
      secrets: () => ['hunter2'],
    });
    sink.write({...FIRST, message: 'password hunter2'});
    await new Promise(resolve => setTimeout(resolve, 0));
    deepStrictEqual(appended, [
      `${plainLineOf({...FIRST, message: 'password [redacted]'})}\n`,
    ]);
  });

  it('wsl-10: a failed append is reported and the lines after it are still written', async () => {
    const appended: string[] = [];
    const failures: unknown[] = [];
    const sink = createFileSink({
      append: text => {
        if (text.includes('first')) {
          return Promise.reject(new Error('disk full'));
        }
        appended.push(text);
        return Promise.resolve();
      },
      onFailure: caught => {
        failures.push(String(caught));
      },
    });
    sink.write(FIRST);
    sink.write(SECOND);
    await new Promise(resolve => setTimeout(resolve, 0));
    deepStrictEqual(
      [failures, appended],
      [['Error: disk full'], [`${plainLineOf(SECOND)}\n`]],
    );
  });
});
