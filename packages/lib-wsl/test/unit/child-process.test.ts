import {deepStrictEqual, rejects} from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {wslProcessOf} from '../../src/child-process.ts';

/** What `command` run by `sh` did with `input`: its output, its error output and its exit status. */
async function shellRun(
  command: string,
  input: string,
): Promise<{printed: string; complained: string; status: number | undefined}> {
  const child = spawn('sh', ['-c', command]);
  const live = wslProcessOf(child);
  const printed: string[] = [];
  const complained: string[] = [];
  live.onOutput(chunk => printed.push(new TextDecoder().decode(chunk)));
  live.onError(chunk => complained.push(new TextDecoder().decode(chunk)));
  const exited = new Promise<number | undefined>(resolve => {
    live.onExit(resolve);
  });
  await live.write(new TextEncoder().encode(input));
  live.endInput();
  const status = await exited;
  return {printed: printed.join(''), complained: complained.join(''), status};
}

describe('wslProcessOf', () => {
  it('#3282: delivers the output and the error output, takes the input, and reports the exit status', async () => {
    deepStrictEqual(await shellRun('cat; echo bad >&2; exit 3', 'in\n'), {
      printed: 'in\n',
      complained: 'bad\n',
      status: 3,
    });
  });

  it('#3282: kill ends the process, and its status is none', async () => {
    const child = spawn('sh', ['-c', 'sleep 30']);
    const live = wslProcessOf(child);
    const exited = new Promise<number | undefined>(resolve => {
      live.onExit(resolve);
    });
    live.kill();
    deepStrictEqual(await exited, undefined);
  });

  it('#3282: a write to a process whose input closed rejects with the stream error', async () => {
    const child = spawn('sh', ['-c', 'exit 0']);
    const live = wslProcessOf(child);
    await new Promise<void>(resolve => {
      live.onExit(() => {
        resolve();
      });
    });
    await rejects(live.write(new Uint8Array(8)));
  });
});
