import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  type StandDownHost,
  standDownIfPresent,
  type StandDownRequest,
} from '../../src/index.ts';

const REQUEST: StandDownRequest = {
  standsDownFor: 'publisher.other-extension',
  standingDownKey: 'remote-x.standingDown',
  warning: 'Another extension provides these features.',
  button: 'Show Extension',
};

/** A host that records every call in order and answers the warning with `choice` once `answer` is called. */
class RecordingHost implements StandDownHost {
  readonly calls: string[] = [];
  readonly running: boolean;
  answer: (choice: string | undefined) => void = () => undefined;

  constructor(running: boolean) {
    this.running = running;
  }

  isRunning(extensionId: string): boolean {
    this.calls.push(`lookup ${extensionId}`);
    return this.running;
  }

  setContext(contextKey: string, value: boolean): PromiseLike<unknown> {
    this.calls.push(`setContext ${contextKey}=${String(value)}`);
    return Promise.resolve();
  }

  showWarning(text: string, button: string): PromiseLike<string | undefined> {
    this.calls.push(`warning ${text} [${button}]`);
    return new Promise(resolve => {
      this.answer = resolve;
    });
  }

  revealExtension(extensionId: string): PromiseLike<unknown> {
    this.calls.push(`reveal ${extensionId}`);
    return Promise.resolve();
  }
}

describe('standDownIfPresent', () => {
  describe('the other extension is absent', () => {
    it('serves (R-54)', async () => {
      strictEqual(
        await standDownIfPresent(new RecordingHost(false), REQUEST),
        'serving',
      );
    });

    it('looks the extension up, then sets the key to false, clearing a stale value (F-5901 §5 step 2)', async () => {
      const host = new RecordingHost(false);
      await standDownIfPresent(host, REQUEST);
      deepStrictEqual(host.calls, [
        'lookup publisher.other-extension',
        'setContext remote-x.standingDown=false',
      ]);
    });
  });

  describe('the other extension runs', () => {
    it('stands down (R-54, F-5901 §5 step 1)', async () => {
      strictEqual(
        await standDownIfPresent(new RecordingHost(true), REQUEST),
        'standing',
      );
    });

    it('sets the key to true, then shows exactly one warning (F-5901 §5 steps 2 and 3)', async () => {
      const host = new RecordingHost(true);
      await standDownIfPresent(host, REQUEST);
      deepStrictEqual(host.calls, [
        'lookup publisher.other-extension',
        'setContext remote-x.standingDown=true',
        'warning Another extension provides these features. [Show Extension]',
      ]);
    });

    it('resolves without waiting for the warning to close (F-5901 §5 step 3)', async () => {
      const host = new RecordingHost(true);
      strictEqual(await standDownIfPresent(host, REQUEST), 'standing');
    });

    it("F-5001.AC-20: opens the Extensions view on the other extension when the user chooses the warning's button (F-5901 §5 step 4)", async () => {
      const host = new RecordingHost(true);
      await standDownIfPresent(host, REQUEST);
      host.answer('Show Extension');
      await Promise.resolve();
      strictEqual(host.calls.at(-1), 'reveal publisher.other-extension');
    });

    it('F-5001.AC-20: opens nothing when the user dismisses the warning', async () => {
      const host = new RecordingHost(true);
      await standDownIfPresent(host, REQUEST);
      host.answer(undefined);
      await Promise.resolve();
      strictEqual(host.calls.length, 3);
    });
  });

  describe('a package that gates nothing', () => {
    it('sets no context key without a standing-down key', async () => {
      const host = new RecordingHost(true);
      await standDownIfPresent(host, {
        standsDownFor: REQUEST.standsDownFor,
        warning: REQUEST.warning,
        button: REQUEST.button,
      });
      deepStrictEqual(host.calls, [
        'lookup publisher.other-extension',
        'warning Another extension provides these features. [Show Extension]',
      ]);
    });

    it('sets no context key while the key is not yet named', async () => {
      const host = new RecordingHost(false);
      await standDownIfPresent(host, {...REQUEST, standingDownKey: ''});
      deepStrictEqual(host.calls, ['lookup publisher.other-extension']);
    });
  });
});
