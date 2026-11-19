import {deepStrictEqual} from 'node:assert';
import {closeWindow, execSpawnedIn, openWindow} from '../windows/harness.ts';

/** The value the spawned process is given in its environment, which no argument may carry. */
const SECRET = 'c146-secret-value';

describe('the exec server of an SSH window on the CLI path (card connect-146)', function () {
  this.timeout(300_000);

  it('brief-remote-ssh-engines §2 (c146-spawn): the window’s exec server spawns a process that prints, exits 0 and gets its environment variable, which no argument of it carries', async () => {
    await openWindow('harness', 'c146-spawn');
    try {
      const spawned = await execSpawnedIn(
        'c146-spawn',
        'sh',
        [
          '-c',
          'echo "value=$C146_VALUE"; printf "argv="; tr "\\000" " " < /proc/$$/cmdline; echo',
        ],
        {C146_VALUE: SECRET},
      );
      const [valueLine = '', argumentLine = ''] = spawned.text.split('\n');
      deepStrictEqual(
        {
          exitCode: spawned.exitCode,
          valueLine,
          argumentLineStarts: argumentLine.startsWith('argv='),
          argumentLineCarries: argumentLine.includes(SECRET),
        },
        {
          exitCode: 0,
          valueLine: `value=${SECRET}`,
          argumentLineStarts: true,
          argumentLineCarries: false,
        },
        `the spawned process printed ${JSON.stringify(spawned.text)}`,
      );
    } finally {
      await closeWindow('c146-spawn').catch(() => undefined);
    }
  });
});
