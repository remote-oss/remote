import {deepStrictEqual} from 'node:assert';
import {commands} from '../../src/identifiers.generated.ts';
import {
  activateInWindow,
  type WindowEditor,
} from '../../src/window-activation.ts';

const REFERENCE_ID = 'ms-vscode.remote-explorer';

/** The editor as far as the window's activation reads it, writing what happens to a list. */
function editorOf(events: string[], referencePresent: boolean): WindowEditor {
  const editor = {
    extensions: {
      getExtension: (extensionId: string) =>
        extensionId === REFERENCE_ID && referencePresent ? {} : undefined,
    },
    commands: {
      executeCommand: (command: string, ...commandArguments: unknown[]) => {
        events.push(`${command} ${commandArguments.join(' ')}`);
        return Promise.resolve();
      },
      registerCommand: (commandId: string) => {
        events.push(`register ${commandId}`);
        return {
          dispose: () => {
            events.push(`unregister ${commandId}`);
          },
        };
      },
    },
    window: {
      showWarningMessage: (text: string, button: string) => {
        events.push(`warning ${text} | ${button}`);
        return Promise.resolve(undefined);
      },
      showInformationMessage: () => Promise.resolve(undefined),
    },
    workspace: {getConfiguration: () => ({inspect: () => undefined})},
    l10n: {t: (template: string) => template},
  };
  return editor as unknown as WindowEditor;
}

interface Context {
  subscriptions: Array<{dispose(): unknown}>;
  extension: {packageJSON: unknown};
}

function contextOf(): Context {
  return {subscriptions: [], extension: {packageJSON: {displayName: 'X'}}};
}

const COMMAND_IDS = Object.values(commands).map(entry => entry.id);

describe('the activation of a window (card explorer-03c)', () => {
  it('F-5001.BR-10: where the other runs, the warning shows, setup is not called, nothing is registered and nothing is added', async () => {
    const events: string[] = [];
    const context = contextOf();
    await activateInWindow(editorOf(events, true), context as never, () => {
      events.push('setup');
      return Promise.resolve();
    });
    deepStrictEqual(
      [events.length, events[0], context.subscriptions.length],
      [2, 'setContext remote-explorer.standingDown true', 0],
    );
  });

  it('F-5001.BR-11: where the other does not run, the key is cleared, setup runs, then the commands are registered and one entry is added', async () => {
    const events: string[] = [];
    const context = contextOf();
    await activateInWindow(editorOf(events, false), context as never, () => {
      events.push('setup');
      return Promise.resolve();
    });
    deepStrictEqual(
      [events, context.subscriptions.length],
      [
        [
          'setContext remote-explorer.standingDown false',
          'setup',
          ...COMMAND_IDS.map(commandId => `register ${commandId}`),
        ],
        1,
      ],
    );
  });

  it('F-5001.BR-11: disposing the entry disposes the registrations', async () => {
    const events: string[] = [];
    const context = contextOf();
    await activateInWindow(editorOf(events, false), context as never, () =>
      Promise.resolve(),
    );
    events.length = 0;
    context.subscriptions[0]?.dispose();
    deepStrictEqual(
      events,
      COMMAND_IDS.map(commandId => `unregister ${commandId}`),
    );
  });

  it('F-5902.AC-25: with the setup of the web entry the commands are registered and nothing is shown', async () => {
    const events: string[] = [];
    await activateInWindow(editorOf(events, false), contextOf() as never, () =>
      Promise.resolve(),
    );
    deepStrictEqual(
      events.filter(event => event.startsWith('warning')),
      [],
    );
  });
});
