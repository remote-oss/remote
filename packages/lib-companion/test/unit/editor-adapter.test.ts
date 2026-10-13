import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  type CompanionEditorApi,
  commandBus,
  systemTimers,
  writeEnvelope,
} from '../../src/index.ts';

const ENVELOPE = writeEnvelope();

/** An editor whose commands are the given operations. */
function editorWith(operations: object): CompanionEditorApi {
  return {commands: operations as CompanionEditorApi['commands']};
}

describe('the editor adapter of the call protocol', () => {
  it('F-5902.5.rules: the command bus forwards a command to the editor and gives its promise itself', () => {
    const answer = Promise.resolve('answer');
    const given: unknown[][] = [];
    const adapter = commandBus(
      editorWith({
        executeCommand: (...commandArguments: unknown[]) => {
          given.push(commandArguments);
          return answer;
        },
      }),
    );
    deepStrictEqual(
      [
        adapter.executeCommand('x', ENVELOPE) === answer,
        given[0]?.[0],
        given[0]?.[1] === ENVELOPE,
      ],
      [true, 'x', true],
    );
  });

  it('F-5902.5.rules: the command bus registers a callback with the editor and gives its disposable itself', () => {
    const disposable = {dispose: () => undefined};
    const registered: unknown[][] = [];
    const adapter = commandBus(
      editorWith({
        registerCommand: (...commandArguments: unknown[]) => {
          registered.push(commandArguments);
          return disposable;
        },
      }),
    );
    function callback(): void {
      registered.push(['called']);
    }
    deepStrictEqual(
      [
        adapter.registerCommand('y', callback) === disposable,
        registered[0]?.[0],
        registered[0]?.[1] === callback,
      ],
      [true, 'y', true],
    );
  });

  it('F-5902.5.rules: a timer runs its callback once, and a cleared timer never runs', async () => {
    let first = 0;
    let second = 0;
    systemTimers.setTimer(() => {
      first += 1;
    }, 1);
    const handle = systemTimers.setTimer(() => {
      second += 1;
    }, 1);
    systemTimers.clearTimer(handle);
    await new Promise(resolve => setTimeout(resolve, 20));
    strictEqual(first * 10 + second, 10);
  });
});
