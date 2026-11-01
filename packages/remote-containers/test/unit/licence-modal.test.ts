import {deepStrictEqual} from 'node:assert';
import {licenceModalOf} from '../../src/surfaces/licence-modal.ts';

const NAMES = {displayName: 'Dev Containers', applicationName: 'VSCodium'};

/** A modal that answers `chosen` and records what it was shown. */
function modalAnswering(chosen: string | undefined | Error) {
  const shown: unknown[] = [];
  const modal = licenceModalOf(
    {
      showModal: (message, detail, buttons) => {
        shown.push([message, detail, buttons]);
        return chosen instanceof Error
          ? Promise.reject(chosen)
          : Promise.resolve(chosen);
      },
    },
    template => template,
    NAMES,
  );
  return {modal, shown};
}

const NEVER = new AbortController().signal;

describe('the licence modal (card containers-08)', () => {
  it('R-68: the modal names the extension, the application and the terms, with the one button Accept and Continue, the editor adding its own Cancel', async () => {
    const {modal, shown} = modalAnswering('Accept and Continue');
    await modal.askUser('https://terms.example/x', NEVER);
    deepStrictEqual(shown, [
      [
        'Dev Containers needs you to accept the license terms of the VSCodium server before installing it.',
        'Read the terms at https://terms.example/x.',
        ['Accept and Continue'],
      ],
    ]);
  });

  it('R-68: only Accept and Continue accepts', async () => {
    deepStrictEqual(
      [
        await modalAnswering('Accept and Continue').modal.askUser('u', NEVER),
        await modalAnswering('Cancel').modal.askUser('u', NEVER),
        await modalAnswering(undefined).modal.askUser('u', NEVER),
      ],
      ['accept', 'cancel', 'cancel'],
    );
  });

  it('R-68: a modal that cannot be shown is no acceptance', async () => {
    deepStrictEqual(
      await modalAnswering(new Error('no window')).modal.askUser('u', NEVER),
      'cancel',
    );
  });

  it('R-68: a cancellation that came first shows nothing', async () => {
    const {modal, shown} = modalAnswering('Accept and Continue');
    const controller = new AbortController();
    controller.abort();
    deepStrictEqual(
      [await modal.askUser('u', controller.signal), shown],
      ['cancel', []],
    );
  });
});
