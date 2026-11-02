import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  inWindow,
  onHost,
  openWindow,
  waitFor,
} from '../windows/harness.ts';
import {pageText} from '../windows/renderer.ts';

/** Writes `text` to `path` on the host, making the folder first. */
async function writeOnHost(path: string, text: string): Promise<void> {
  await onHost(
    'sh',
    '-c',
    `mkdir -p "$(dirname '${path}')" && cat > '${path}' <<'EOF'\n${text}\nEOF`,
  );
}

describe('debugging in an SSH window (card coverage-80)', function () {
  this.timeout(300_000);

  it('F-2508 AC-12 (c80-debug): a node launch configuration runs the program on the host, stops at the debugger statement and prints in the Debug Console', async () => {
    const root = '/home/harness/c80-debug';
    const host = (await onHost('hostname')).trim();
    await writeOnHost(
      `${root}/app.js`,
      `console.log('c80-printed-on-' + require('os').hostname());\ndebugger;\nsetTimeout(() => undefined, 60000);`,
    );
    await writeOnHost(
      `${root}/.vscode/launch.json`,
      JSON.stringify({
        version: '0.2.0',
        configurations: [
          {
            type: 'node',
            request: 'launch',
            name: 'Run app',
            program: '${workspaceFolder}/app.js',
          },
        ],
      }),
    );
    await openWindow('harness', 'c80-debug');
    try {
      await inWindow('c80-debug', 'workbench.action.debug.start');
      await waitFor(
        'the program to stop and print',
        async () => {
          const text = await pageText('c80-debug');
          return (
            text.includes(`c80-printed-on-${host}`) &&
            text.includes('debugging paused')
          );
        },
        90_000,
      );
      const text = await pageText('c80-debug');
      deepStrictEqual(
        [
          text.includes(`c80-printed-on-${host}`),
          text.includes('debugging paused'),
          text.includes('app.js:2'),
        ],
        [true, true, true],
      );
    } finally {
      await inWindow('c80-debug', 'workbench.action.debug.stop').catch(
        () => undefined,
      );
      await closeWindow('c80-debug').catch(() => undefined);
    }
  });
});
