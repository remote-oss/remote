import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  type CompanionEditorApi,
  type DetectorEditorApi,
  commandBus,
  extensionLookup,
  systemTimers,
  writeEnvelope,
} from '../../src/index.ts';

const ENVELOPE = writeEnvelope();

/** An editor whose commands are the given operations. */
function editorWith(operations: object): CompanionEditorApi {
  return {commands: operations as CompanionEditorApi['commands']};
}

/** An editor whose extensions are the given operations. */
function detectorEditorWith(operations: object): DetectorEditorApi {
  return {extensions: operations as DetectorEditorApi['extensions']};
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

  it('F-5902.AC-26: the lookup asks for an extension across hosts and never reads the list across hosts', () => {
    const asked: unknown[][] = [];
    let reads = 0;
    const lookup = extensionLookup(
      detectorEditorWith({
        getExtension: (...given: unknown[]) => {
          asked.push(given);
          return given[0] === 'remote-oss.remote-ssh' ? {} : undefined;
        },
        get allAcrossExtensionHosts() {
          reads += 1;
          throw new Error('needs the grant');
        },
      }),
    );
    deepStrictEqual(
      [
        lookup.hasExtension('remote-oss.remote-ssh'),
        lookup.hasExtension('other.id'),
        asked,
        reads,
      ],
      [
        true,
        false,
        [
          ['remote-oss.remote-ssh', true],
          ['other.id', true],
        ],
        0,
      ],
    );
  });

  it('F-5902.5.detection: the lookup hands the editor event on without an argument and gives its disposable itself', () => {
    const disposable = {dispose: () => undefined};
    const editorHooks: {listener?: (...given: unknown[]) => void} = {};
    const lookup = extensionLookup(
      detectorEditorWith({
        onDidChange: (listener: (...given: unknown[]) => void) => {
          editorHooks.listener = listener;
          return disposable;
        },
      }),
    );
    const calls: unknown[][] = [];
    const registration = lookup.onDidChange((...given: unknown[]) => {
      calls.push(given);
    });
    editorHooks.listener?.('event');
    deepStrictEqual([registration === disposable, calls], [true, [[]]]);
  });
});
