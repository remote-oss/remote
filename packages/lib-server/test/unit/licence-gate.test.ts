import {deepStrictEqual} from 'node:assert';
import {createLogger, type Logger, resetOncePerSession} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  type AcceptanceStore,
  acceptanceKey,
  classifyServerLicence,
  ensureAccepted,
  type LicenceModal,
  type LicenceTerms,
  type ModalAnswer,
} from '../../src/index.ts';

const VSCODE_TERMS: LicenceTerms = {
  serverLicenseEmpty: false,
  serverLicenseUrl: 'https://terms.example/server',
};

const VSCODIUM_TERMS: LicenceTerms = {
  serverLicenseEmpty: true,
  serverLicenseUrl: '',
};

const FROM_UPDATE_SERVICE = {
  step: 'builtInTable',
  downloadUrl:
    'https://update.code.visualstudio.com/commit/abc/server-linux-x64/stable',
  serverLicenseEmpty: false,
  updateUrl: 'https://update.code.visualstudio.com',
} as const;

const FROM_VSCODIUM = {
  step: 'builtInTable',
  downloadUrl:
    'https://github.com/VSCodium/vscodium/releases/download/1/x.tar.gz',
  serverLicenseEmpty: true,
  updateUrl: '',
} as const;

/** A store in memory that counts what is asked of it. */
class MemoryStore implements AcceptanceStore {
  readonly accepted = new Set<string>();
  readonly writes: string[] = [];

  isAccepted(entryKey: string): boolean {
    return this.accepted.has(entryKey);
  }

  accept(entryKey: string): Promise<void> {
    this.accepted.add(entryKey);
    this.writes.push(entryKey);
    return Promise.resolve();
  }
}

/** How a scripted modal ends: with an answer, a rejection, a synchronous throw, or a dismissal without an answer. */
type ModalScript = ModalAnswer | 'rejects' | 'throws' | 'dismissed';

/** A modal that behaves as scripted and records the pages it was asked about. */
class ScriptedModal implements LicenceModal {
  readonly asked: string[] = [];
  private readonly script: ModalScript;

  constructor(script: ModalScript) {
    this.script = script;
  }

  askUser(termsUrl: string): Promise<ModalAnswer> {
    this.asked.push(termsUrl);
    if (this.script === 'throws') {
      throw new Error('the modal could not open');
    }
    if (this.script === 'rejects') {
      return Promise.reject(new Error('the window closed'));
    }
    // A dismissed modal resolves with no answer at all.
    return Promise.resolve(
      this.script === 'dismissed' ? (undefined as never) : this.script,
    );
  }
}

/** A store whose write fails. */
class FailingStore extends MemoryStore {
  override accept(): Promise<void> {
    return Promise.reject(new Error('the state could not be saved'));
  }
}

/** A logger that writes to the given sink. */
function loggerOver(sink: MemorySink): Logger {
  return createLogger(sink, {minimumLevel: () => 'info'});
}

/** `ensureAccepted` with a logger whose lines are not looked at. */
function gate(
  classification: Parameters<typeof ensureAccepted>[0],
  store: AcceptanceStore,
  modal: LicenceModal,
  cancellation: AbortSignal = new AbortController().signal,
): ReturnType<typeof ensureAccepted> {
  return ensureAccepted(
    classification,
    store,
    modal,
    loggerOver(new MemorySink()),
    cancellation,
  );
}

/** A counting AbortSignal: it records how often the gate adds and removes its abort listener. */
function countingSignal(startedAborted = false): {
  signal: AbortSignal;
  adds: number;
  removes: number;
  abort: () => void;
} {
  let adds = 0;
  let removes = 0;
  let aborted = startedAborted;
  const listeners = new Set<() => void>();
  const signal = {
    get aborted() {
      return aborted;
    },
    addEventListener(type: string, listener: () => void) {
      if (type === 'abort') {
        adds += 1;
        listeners.add(listener);
      }
    },
    removeEventListener(type: string, listener: () => void) {
      if (type === 'abort') {
        removes += 1;
        listeners.delete(listener);
      }
    },
  } as unknown as AbortSignal;
  return {
    signal,
    get adds() {
      return adds;
    },
    get removes() {
      return removes;
    },
    abort() {
      aborted = true;
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

describe('classifyServerLicence (V6)', () => {
  it('F-3902.AC-14: a download from the update service is licensed, with the editor’s own terms link', () => {
    deepStrictEqual(classifyServerLicence(FROM_UPDATE_SERVICE, VSCODE_TERMS), {
      kind: 'microsoftLicensed',
      termsUrl: 'https://terms.example/server',
    });
  });

  it('F-3902.11: the terms link falls back to the page of the product table', () => {
    deepStrictEqual(
      classifyServerLicence(FROM_UPDATE_SERVICE, {
        ...VSCODE_TERMS,
        serverLicenseUrl: '',
      }),
      {
        kind: 'microsoftLicensed',
        termsUrl: 'https://aka.ms/vscode-server-license',
      },
    );
  });

  it('F-1402.AC-4: the built-in VSCodium release is free', () => {
    deepStrictEqual(classifyServerLicence(FROM_VSCODIUM, VSCODIUM_TERMS), {
      kind: 'free',
    });
  });

  it('R-80: the clientLicence rule, when it is the active one, would license a free source on VS Code', () => {
    deepStrictEqual(
      classifyServerLicence(
        {...FROM_VSCODIUM, serverLicenseEmpty: false},
        VSCODE_TERMS,
        ['clientLicence'],
      ).kind,
      'microsoftLicensed',
    );
  });
});

describe('acceptanceKey (V6)', () => {
  it('F-3902.11: the key is derived from the terms page', () => {
    deepStrictEqual(
      acceptanceKey('https://terms.example/server'),
      'serverLicence:https://terms.example/server',
    );
  });
});

describe('ensureAccepted (V6)', () => {
  const LICENSED = {
    kind: 'microsoftLicensed',
    termsUrl: 'https://terms.example/server',
  } as const;

  it('F-1402.AC-4: a free server is cleared without a question and without the flag', async () => {
    const modal = new ScriptedModal('accept');
    deepStrictEqual(
      [await gate({kind: 'free'}, new MemoryStore(), modal), modal.asked],
      [{kind: 'cleared', acceptanceFlag: false, remembered: false}, []],
    );
  });

  it('F-3902.AC-10: a licensed server asks once, with the terms link', async () => {
    const modal = new ScriptedModal('accept');
    await gate(LICENSED, new MemoryStore(), modal);
    deepStrictEqual(modal.asked, ['https://terms.example/server']);
  });

  it('F-3902.AC-10: "Accept and Continue" clears the server with the flag', async () => {
    deepStrictEqual(
      await gate(LICENSED, new MemoryStore(), new ScriptedModal('accept')),
      {kind: 'cleared', acceptanceFlag: true, remembered: true},
    );
  });

  it('F-3902.11: the acceptance is stored under the key of the terms page', async () => {
    const store = new MemoryStore();
    await gate(LICENSED, store, new ScriptedModal('accept'));
    deepStrictEqual(store.writes, [
      'serverLicence:https://terms.example/server',
    ]);
  });

  it('F-3902.AC-11: a stored acceptance is not asked again', async () => {
    const store = new MemoryStore();
    await gate(LICENSED, store, new ScriptedModal('accept'));
    const modal = new ScriptedModal('cancel');
    deepStrictEqual(
      [await gate(LICENSED, store, modal), modal.asked],
      [{kind: 'cleared', acceptanceFlag: true, remembered: true}, []],
    );
  });

  it('F-3902.AC-12: "Cancel" declines', async () => {
    deepStrictEqual(
      await gate(LICENSED, new MemoryStore(), new ScriptedModal('cancel')),
      {kind: 'licenceDeclined'},
    );
  });

  it('F-3902.AC-12: "Cancel" remembers nothing', async () => {
    const store = new MemoryStore();
    await gate(LICENSED, store, new ScriptedModal('cancel'));
    deepStrictEqual(store.writes, []);
  });

  it('R-68: a modal that fails never counts as an acceptance', async () => {
    const store = new MemoryStore();
    deepStrictEqual(
      [await gate(LICENSED, store, new ScriptedModal('rejects')), store.writes],
      [{kind: 'licenceDeclined'}, []],
    );
  });

  it('R-68: a modal that throws before it returns a promise is a decline', async () => {
    deepStrictEqual(
      await gate(LICENSED, new MemoryStore(), new ScriptedModal('throws')),
      {kind: 'licenceDeclined'},
    );
  });

  it('R-68: a modal that is dismissed without an answer is a decline', async () => {
    deepStrictEqual(
      await gate(LICENSED, new MemoryStore(), new ScriptedModal('dismissed')),
      {kind: 'licenceDeclined'},
    );
  });

  it('R-68: a dismissed modal stores nothing', async () => {
    const store = new MemoryStore();
    await gate(LICENSED, store, new ScriptedModal('dismissed'));
    deepStrictEqual(store.writes, []);
  });

  it('F-3902.AC-10: an acceptance whose store fails still clears the server, and says it was not remembered', async () => {
    deepStrictEqual(
      await gate(LICENSED, new FailingStore(), new ScriptedModal('accept')),
      {kind: 'cleared', acceptanceFlag: true, remembered: false},
    );
  });

  /** The messages logged by two acceptances whose store fails, in one session. */
  async function loggedByTwoFailures(): Promise<string[]> {
    resetOncePerSession();
    const sink = new MemorySink();
    for (let attempt = 0; attempt < 2; attempt++) {
      await ensureAccepted(
        LICENSED,
        new FailingStore(),
        new ScriptedModal('accept'),
        loggerOver(sink),
        new AbortController().signal,
      );
    }
    return sink.lines.map(line => line.message);
  }

  it('F-3902.AC-10: a store failure is logged once per session, with its reason', async () => {
    deepStrictEqual(await loggedByTwoFailures(), [
      'the licence acceptance could not be stored: the state could not be saved',
    ]);
  });

  it('F-3902.AC-10: a store that works logs nothing', async () => {
    resetOncePerSession();
    const sink = new MemorySink();
    await ensureAccepted(
      LICENSED,
      new MemoryStore(),
      new ScriptedModal('accept'),
      loggerOver(sink),
      new AbortController().signal,
    );
    deepStrictEqual(sink.lines, []);
  });

  it('F-3902.11: another terms page is a separate acceptance', async () => {
    const store = new MemoryStore();
    await gate(LICENSED, store, new ScriptedModal('accept'));
    const modal = new ScriptedModal('accept');
    await gate(
      {kind: 'microsoftLicensed', termsUrl: 'https://terms.example/other'},
      store,
      modal,
    );
    deepStrictEqual(modal.asked, ['https://terms.example/other']);
  });

  it('an already-aborted signal is a cancellation without a question, nothing stored', async () => {
    const controller = new AbortController();
    controller.abort();
    const store = new MemoryStore();
    const modal = new ScriptedModal('accept');
    deepStrictEqual(
      [
        await gate(LICENSED, store, modal, controller.signal),
        modal.asked,
        store.writes,
      ],
      [{kind: 'cancelled'}, [], []],
    );
  });

  it('a question that is aborted while it is open is a cancellation, whatever the modal answers afterwards', async () => {
    const store = new MemoryStore();
    const modal = new ScriptedModal('accept');
    const controller = new AbortController();
    const asking = gate(LICENSED, store, modal, controller.signal);
    controller.abort();
    deepStrictEqual([await asking, store.writes], [{kind: 'cancelled'}, []]);
  });

  it('the modal answers accept; then the signal aborts: the gate cleared and left no listener', async () => {
    const counting = countingSignal();
    const asking = gate(
      LICENSED,
      new MemoryStore(),
      new ScriptedModal('accept'),
      counting.signal,
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    counting.abort();
    deepStrictEqual(
      [await asking, counting.adds, counting.removes],
      [{kind: 'cleared', acceptanceFlag: true, remembered: true}, 1, 1],
    );
  });

  it('the modal answers cancel; then the signal aborts: licenceDeclined, no listener left', async () => {
    const counting = countingSignal();
    const asking = gate(
      LICENSED,
      new MemoryStore(),
      new ScriptedModal('cancel'),
      counting.signal,
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    counting.abort();
    deepStrictEqual(
      [await asking, counting.adds, counting.removes],
      [{kind: 'licenceDeclined'}, 1, 1],
    );
  });

  it('the signal aborts while the question is open: cancelled, the listener is removed', async () => {
    const counting = countingSignal();
    const store = new MemoryStore();
    const modal = new ScriptedModal('accept');
    const asking = gate(LICENSED, store, modal, counting.signal);
    counting.abort();
    deepStrictEqual(
      [await asking, store.writes, counting.adds, counting.removes],
      [{kind: 'cancelled'}, [], 1, 1],
    );
  });

  it('the signal is already aborted: cancelled, no listener is added', async () => {
    const counting = countingSignal(true);
    const store = new MemoryStore();
    const modal = new ScriptedModal('accept');
    deepStrictEqual(
      [await gate(LICENSED, store, modal, counting.signal), counting.adds],
      [{kind: 'cancelled'}, 0],
    );
  });

  it('a free server and a stored acceptance never read the signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const store = new MemoryStore();
    const stored = new ScriptedModal('accept');
    await gate(LICENSED, store, stored);
    deepStrictEqual(
      [
        await gate(
          {kind: 'free'},
          new MemoryStore(),
          new ScriptedModal('accept'),
          controller.signal,
        ),
        await gate(
          LICENSED,
          store,
          new ScriptedModal('cancel'),
          controller.signal,
        ),
        stored.asked,
      ],
      [
        {kind: 'cleared', acceptanceFlag: false, remembered: false},
        {kind: 'cleared', acceptanceFlag: true, remembered: true},
        ['https://terms.example/server'],
      ],
    );
  });
});
