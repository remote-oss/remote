import {deepStrictEqual} from 'node:assert';
import {
  type PreconnectDialogPort,
  preconnectDialogOf,
} from '../../src/surfaces/preconnect-dialog.ts';

const NEVER = new AbortController().signal;

/** The dialog over a port that gives `answer`, with the texts untranslated, and what the port was shown. */
function dialogAnswering(answer: () => PromiseLike<string | undefined>) {
  const shown: Array<{message: string; detail: string; buttons: string[]}> = [];
  const port: PreconnectDialogPort = {
    showModal: (message, detail, buttons) => {
      shown.push({message, detail, buttons: [...buttons]});
      return answer();
    },
  };
  return {dialog: preconnectDialogOf(port, template => template), shown};
}

describe('the pre-connection dialog (card connect-87)', () => {
  it('F-2108 AC-4: the modal has the message, the path in the detail and the three buttons in order', async () => {
    const {dialog, shown} = dialogAnswering(() => Promise.resolve('Allow'));
    const answer = await dialog.askUser('/s/x.sh', false, NEVER);
    deepStrictEqual(
      [answer, shown],
      [
        'allow',
        [
          {
            message: 'Execute pre-connection script?',
            detail: "'/s/x.sh' will be executed on your local machine.",
            buttons: ['Allow', "Allow and Don't Ask Again", 'Skip'],
          },
        ],
      ],
    );
  });

  it('F-2108 AC-13: contents that changed give the message that says so', async () => {
    const {dialog, shown} = dialogAnswering(() => Promise.resolve('Skip'));
    await dialog.askUser('/s/x.sh', true, NEVER);
    deepStrictEqual(
      shown.map(entry => entry.message),
      ['Pre-connection script has changed since last confirmation'],
    );
  });

  it('F-2108 AC-4: each button gives its answer, and Cancel, Escape and X, which give nothing, skip', async () => {
    const results: string[] = [];
    for (const given of [
      'Allow',
      "Allow and Don't Ask Again",
      'Skip',
      undefined,
    ]) {
      const {dialog} = dialogAnswering(() => Promise.resolve(given));
      results.push(await dialog.askUser('/x', false, NEVER));
    }
    deepStrictEqual(results, ['allow', 'allowAlways', 'skip', 'skip']);
  });

  it('F-2108 AC-10: a dialog that cannot be shown skips the script', async () => {
    const {dialog} = dialogAnswering(() =>
      Promise.reject(new Error('no window')),
    );
    deepStrictEqual(await dialog.askUser('/x', false, NEVER), 'skip');
  });

  it('F-2108 AC-42: an abort while the dialog is open gives aborted, and one before it is shown shows nothing', async () => {
    const control = new AbortController();
    const {dialog, shown} = dialogAnswering(
      () => new Promise<string | undefined>(() => undefined),
    );
    const waiting = dialog.askUser('/x', false, control.signal);
    control.abort();
    const early = await dialog.askUser('/y', false, control.signal);
    deepStrictEqual(
      [await waiting, early, shown.length],
      ['aborted', 'aborted', 1],
    );
  });
});
