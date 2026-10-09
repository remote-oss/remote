import {deepStrictEqual} from 'node:assert';
import {CLAIM_COMMAND, type ClaimHost, windowClaimOf} from '../../src/index.ts';

/** One extension host: the commands registered in it, which holders answer and which can be made to fail. */
class FakeHost implements ClaimHost {
  readonly registered = new Map<string, () => string>();
  executeFails = 0;

  registerCommand(command: string, handler: () => string): {dispose(): void} {
    if (this.registered.has(command)) {
      throw new Error(`command '${command}' already exists`);
    }
    this.registered.set(command, handler);
    return {
      dispose: () => {
        this.registered.delete(command);
      },
    };
  }

  executeCommand(command: string): PromiseLike<unknown> {
    const handler = this.registered.get(command);
    if (this.executeFails > 0 || handler === undefined) {
      this.executeFails = Math.max(0, this.executeFails - 1);
      return Promise.reject(new Error(`command '${command}' not found`));
    }
    return Promise.resolve(handler());
  }
}

const FIRST = 'remote-oss.remote-ssh';
const SECOND = 'remote-oss.remote-explorer';

describe('the claim on the notification of a window (contracts section 3.4)', () => {
  it('F-1403: the command is the family-internal id', () => {
    deepStrictEqual(CLAIM_COMMAND, 'remote-oss.gate.claim');
  });

  it('F-1403: the first extension to claim holds the window', async () => {
    const host = new FakeHost();
    deepStrictEqual(await windowClaimOf(host, []).claim(FIRST), {
      holder: FIRST,
    });
  });

  it("F-1403: the registration goes into the extension's subscriptions", async () => {
    const host = new FakeHost();
    const subscriptions: Array<{dispose(): void}> = [];
    await windowClaimOf(host, subscriptions).claim(FIRST);
    deepStrictEqual(subscriptions.length, 1);
  });

  it('F-1403: a second extension is told who holds the window', async () => {
    const host = new FakeHost();
    await windowClaimOf(host, []).claim(FIRST);
    deepStrictEqual(await windowClaimOf(host, []).claim(SECOND), {
      holder: FIRST,
    });
  });

  it('F-1403: an extension that does not hold the window registers nothing', async () => {
    const host = new FakeHost();
    const subscriptions: Array<{dispose(): void}> = [];
    await windowClaimOf(host, []).claim(FIRST);
    await windowClaimOf(host, subscriptions).claim(SECOND);
    deepStrictEqual(subscriptions.length, 0);
  });

  it('F-1403: when the holder went away between the two steps the extension registers once more', async () => {
    const host = new FakeHost();
    await windowClaimOf(host, []).claim(FIRST);
    const original = host.registerCommand.bind(host);
    let calls = 0;
    host.registerCommand = (command, handler) => {
      calls += 1;
      if (calls === 1) {
        host.registered.delete(command);
        throw new Error('already exists');
      }
      return original(command, handler);
    };
    deepStrictEqual(await windowClaimOf(host, []).claim(SECOND), {
      holder: SECOND,
    });
  });

  it('F-1403: a second failure to register leaves the holder unknown', async () => {
    const host = new FakeHost();
    host.registerCommand = () => {
      throw new Error('already exists');
    };
    deepStrictEqual(await windowClaimOf(host, []).claim(SECOND), {
      holder: undefined,
    });
  });

  it('F-1403: an answer that is not an extension id counts as no answer', async () => {
    const host = new FakeHost();
    host.executeCommand = () => Promise.resolve(42);
    host.registerCommand = () => {
      throw new Error('already exists');
    };
    deepStrictEqual(await windowClaimOf(host, []).claim(SECOND), {
      holder: undefined,
    });
  });

  it("F-1403: releasing the holder's registration lets the next extension claim the window", async () => {
    const host = new FakeHost();
    const subscriptions: Array<{dispose(): void}> = [];
    await windowClaimOf(host, subscriptions).claim(FIRST);
    subscriptions[0]?.dispose();
    deepStrictEqual(await windowClaimOf(host, []).claim(SECOND), {
      holder: SECOND,
    });
  });
});
