import {deepStrictEqual, strictEqual} from 'node:assert';
import type {CommandEntry} from '../../src/index.ts';
import {
  type CommandManifest,
  type EditorApi,
  identifierHost,
} from '../../src/index.ts';

const OPEN: CommandEntry = {
  id: 'remote-x.open',
  title: '%open%',
  palette: true,
  policy: 'infoLine',
};

const MANIFEST: CommandManifest = {
  contributes: {commands: [{command: 'remote-x.open', title: 'Öffnen'}]},
};

interface EditorCalls {
  registered: string[];
  informations: string[];
  executed: unknown[][];
  inspected: string[];
}

function fakeEditor(
  calls: EditorCalls,
  inspection: object | undefined,
): EditorApi {
  const fake = {
    commands: {
      registerCommand: (commandId: string) => {
        calls.registered.push(commandId);
        return {dispose: () => undefined};
      },
      executeCommand: (...commandArguments: unknown[]) => {
        calls.executed.push(commandArguments);
        return Promise.resolve();
      },
    },
    window: {
      showInformationMessage: (text: string) => {
        calls.informations.push(text);
        return Promise.resolve(undefined);
      },
    },
    workspace: {
      getConfiguration: () => ({
        inspect: (settingId: string) => {
          calls.inspected.push(settingId);
          return inspection;
        },
      }),
    },
    l10n: {
      t: (message: string, ...values: string[]) =>
        message.replace('{0}', values[0] ?? ''),
    },
  };
  // The fake implements only the members the adapter calls.
  return fake as unknown as EditorApi;
}

describe('identifierHost', () => {
  let calls: EditorCalls;

  beforeEach(() => {
    calls = {registered: [], informations: [], executed: [], inspected: []};
  });

  it('registers a command with the editor', () => {
    identifierHost(fakeEditor(calls, undefined), MANIFEST).registerCommand(
      'remote-x.open',
      () => undefined,
    );
    deepStrictEqual(calls.registered, ['remote-x.open']);
  });

  it('shows the out-of-context line with the title in the user language (F-2006 AC-22)', () => {
    identifierHost(fakeEditor(calls, undefined), MANIFEST).showOutOfContext(
      OPEN,
    );
    deepStrictEqual(calls.informations, [
      "'Öffnen' is not possible in the current context.",
    ]);
  });

  it("falls back to the table's title for a command the manifest does not list", () => {
    identifierHost(fakeEditor(calls, undefined), {}).showOutOfContext(OPEN);
    deepStrictEqual(calls.informations, [
      "'%open%' is not possible in the current context.",
    ]);
  });

  it("reports a setting's values at each level", () => {
    const inspection = {defaultValue: 'info', globalValue: 'trace'};
    strictEqual(
      identifierHost(fakeEditor(calls, inspection), MANIFEST).inspectSetting(
        'remote.X.logLevel',
      ),
      inspection,
    );
  });

  it('reports no values for a setting the editor does not know', () => {
    deepStrictEqual(
      identifierHost(fakeEditor(calls, undefined), MANIFEST).inspectSetting(
        'remote.X.unknown',
      ),
      {},
    );
  });

  it('sets a context key through the setContext command', async () => {
    await identifierHost(fakeEditor(calls, undefined), MANIFEST).setContext(
      'remote-x.connected',
      true,
    );
    deepStrictEqual(calls.executed, [
      ['setContext', 'remote-x.connected', true],
    ]);
  });
});
