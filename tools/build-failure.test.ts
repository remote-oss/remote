import {deepStrictEqual} from 'node:assert';
import {
  buildErrorLines,
  buildFailedText,
} from '../tests/acceptance/containers-features/build-failure.ts';

describe('the cause a failed Features build names (card #3267)', () => {
  it('#3267: the error lines of a log are those that say what failed, the last four, trimmed, in order', () => {
    deepStrictEqual(
      buildErrorLines([
        '#9 1.0 Installing nvm',
        '#9 2.0 ERROR: one',
        '#9 2.1 fatal: unable to access https://github.com/nvm-sh/nvm/: The requested URL returned error: 403',
        '#9 2.2 (!) the Feature failed to install',
        '#9 2.3 something else',
        '#9 2.4 ERROR: two  ',
        '#9 2.5 ERROR: three',
      ]),
      [
        '#9 2.1 fatal: unable to access https://github.com/nvm-sh/nvm/: The requested URL returned error: 403',
        '#9 2.2 (!) the Feature failed to install',
        '#9 2.4 ERROR: two',
        '#9 2.5 ERROR: three',
      ],
    );
  });

  it('#3267: words that only contain the markers are not error lines', () => {
    deepStrictEqual(
      buildErrorLines(['#1 ERRORS none', '#1 terror', '#1 unfatal: x']),
      [],
    );
  });

  it('#3267: a red names the window, the dialog’s text and buttons, and the error lines', () => {
    deepStrictEqual(
      buildFailedText(
        'c93-ac41',
        {
          message: '',
          details: 'An error occurred setting up the container.',
          buttons: [
            'Edit devcontainer.json Locally',
            'More Actions...',
            'Retry',
          ],
        },
        ['#9 2.1 fatal: unable to access x', '#9 2.2 ok'],
      ).split('\n'),
      [
        "window c93-ac41's build ended in a dialog before it connected: An error occurred setting up the container. [Edit devcontainer.json Locally | More Actions... | Retry]",
        "the build's last error lines:",
        '#9 2.1 fatal: unable to access x',
      ],
    );
  });

  it('#3267: a dialog with no text and a log with no error line say so', () => {
    deepStrictEqual(
      buildFailedText('w', {message: '', details: '', buttons: []}, ['#1 ok']),
      "window w's build ended in a dialog before it connected: (no text) []\nthe containers log holds no error line",
    );
  });

  it('#3267: a dialog with both message and details quotes both', () => {
    deepStrictEqual(
      buildFailedText(
        'w',
        {message: 'a', details: 'b', buttons: ['x']},
        [],
      ).split('\n')[0],
      "window w's build ended in a dialog before it connected: a / b [x]",
    );
  });
});
