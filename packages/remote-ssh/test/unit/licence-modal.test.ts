import {deepStrictEqual} from 'node:assert';
import {
  type LicenceDialogPort,
  licenceModalOf,
} from '../../src/surfaces/licence-modal.ts';

const TERMS = 'https://aka.ms/vscode-server-license';

interface Shown {
  message: string;
  detail: string;
  buttons: readonly string[];
}

function surroundings(answer: () => PromiseLike<string | undefined>) {
  const shown: Shown[] = [];
  const dialog: LicenceDialogPort = {
    showModal: (message, detail, buttons) => {
      shown.push({message, detail, buttons});
      return answer();
    },
  };
  const modal = licenceModalOf(dialog, template => template, {
    displayName: 'Remote - SSH',
  });
  return {modal, shown};
}

describe('the licence modal (F-3902 rule 11)', () => {
  it('F-3902 rule 11: Accept and Continue accepts', async () => {
    const {modal} = surroundings(() => Promise.resolve('Accept and Continue'));
    deepStrictEqual(
      await modal.askUser(TERMS, new AbortController().signal),
      'accept',
    );
  });

  it('F-3902 rule 11: Cancel cancels', async () => {
    const {modal} = surroundings(() => Promise.resolve('Cancel'));
    deepStrictEqual(
      await modal.askUser(TERMS, new AbortController().signal),
      'cancel',
    );
  });

  it('F-3902 rule 11: Escape or closing the modal cancels', async () => {
    const {modal} = surroundings(() => Promise.resolve(undefined));
    deepStrictEqual(
      await modal.askUser(TERMS, new AbortController().signal),
      'cancel',
    );
  });

  it('F-3902 rule 11: a modal that cannot be shown cancels', async () => {
    const {modal} = surroundings(() => Promise.reject(new Error('no window')));
    deepStrictEqual(
      await modal.askUser(TERMS, new AbortController().signal),
      'cancel',
    );
  });

  it('F-3902 rule 11: an already-aborted signal cancels and shows nothing', async () => {
    const {modal, shown} = surroundings(() =>
      Promise.resolve('Accept and Continue'),
    );
    const controller = new AbortController();
    controller.abort();
    deepStrictEqual(
      [await modal.askUser(TERMS, controller.signal), shown],
      ['cancel', []],
    );
  });

  it('F-3902 rule 11: an abort while the modal is open cancels at once', async () => {
    const {modal} = surroundings(
      () => new Promise<string | undefined>(() => undefined),
    );
    const controller = new AbortController();
    const answer = modal.askUser(TERMS, controller.signal);
    controller.abort();
    deepStrictEqual(await answer, 'cancel');
  });

  it('F-3902 rule 11: the abort listener is removed once the answer is given', async () => {
    const {modal} = surroundings(() => Promise.resolve('Cancel'));
    const signal = new AbortController().signal;
    const added: string[] = [];
    const removed: string[] = [];
    signal.addEventListener = (type: string) => {
      added.push(type);
    };
    signal.removeEventListener = (type: string) => {
      removed.push(type);
    };
    await modal.askUser(TERMS, signal);
    deepStrictEqual([added, removed], [['abort'], ['abort']]);
  });

  it('F-3902 rule 11: the message asks to accept the server’s licence terms', async () => {
    const {modal, shown} = surroundings(() => Promise.resolve(undefined));
    await modal.askUser(TERMS, new AbortController().signal);
    deepStrictEqual(shown[0]?.message, "Accept the server's licence terms?");
  });

  it('F-3902 rule 11: the detail names the extension and the address of the terms in full', async () => {
    const {modal, shown} = surroundings(() => Promise.resolve(undefined));
    await modal.askUser(TERMS, new AbortController().signal);
    deepStrictEqual(
      shown[0]?.detail,
      'The server Remote - SSH installs or starts on this host is distributed under licence terms of its own, which Remote - SSH does not accept for you. Read them at https://aka.ms/vscode-server-license before you continue. "Accept and Continue" accepts them for this profile; the choice is remembered for this profile.',
    );
  });

  it('F-3902 rule 11: the one item is Accept and Continue', async () => {
    const {modal, shown} = surroundings(() => Promise.resolve(undefined));
    await modal.askUser(TERMS, new AbortController().signal);
    deepStrictEqual(shown[0]?.buttons, ['Accept and Continue']);
  });
});
