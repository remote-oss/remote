import {deepStrictEqual} from 'node:assert';
import {editorOperationsOf} from '../../src/editor-operations.ts';

/** The fake editor's user-settings target. */
const GLOBAL_TARGET = 1;

/** What the fake editor was asked, in order. */
interface Asked {
  commands: unknown[][];
  updates: unknown[][];
  revealed: number;
}

/** The operations over a fake editor that records its commands and its settings writes. */
function operationsOver(): {
  operations: ReturnType<typeof editorOperationsOf>;
  asked: Asked;
} {
  const asked: Asked = {commands: [], updates: [], revealed: 0};
  const editor = {
    commands: {
      executeCommand: (...given: unknown[]) => {
        asked.commands.push(given);
        return Promise.resolve();
      },
    },
    workspace: {
      getConfiguration: () => ({
        update: (...given: unknown[]) => {
          asked.updates.push(given);
          return Promise.resolve();
        },
      }),
    },
    ConfigurationTarget: {Global: GLOBAL_TARGET},
  } as unknown as Parameters<typeof editorOperationsOf>[0];
  return {
    operations: editorOperationsOf(editor, () => {
      asked.revealed += 1;
    }),
    asked,
  };
}

describe("the editor's operations of the connect's surfaces", () => {
  it('F-2601: Retry reloads the window', async () => {
    const {operations, asked} = operationsOver();
    await operations.reloadWindow();
    deepStrictEqual(asked.commands, [['workbench.action.reloadWindow']]);
  });

  it("F-2501 AC-21: Close Remote runs core's workbench.action.remote.close, which makes the same window local", async () => {
    const {operations, asked} = operationsOver();
    await operations.closeRemote();
    deepStrictEqual(asked.commands, [['workbench.action.remote.close']]);
  });

  it("F-2602 5.0 step 4: Open Recent... runs the editor's recent list", async () => {
    const {operations, asked} = operationsOver();
    await operations.openRecent();
    deepStrictEqual(asked.commands, [['workbench.action.openRecent']]);
  });

  it('F-2602 5.0 step 4: Open SSH Configuration File runs its own command', async () => {
    const {operations, asked} = operationsOver();
    await operations.openConfigFile();
    deepStrictEqual(asked.commands, [['opensshremotes.openConfigFile']]);
  });

  it('F-3902 rule 8: Open Setting opens the Settings editor on that setting', async () => {
    const {operations, asked} = operationsOver();
    await operations.openSetting('remote.SSH.serverDownloadUrlTemplate');
    deepStrictEqual(asked.commands, [
      ['workbench.action.openSettings', 'remote.SSH.serverDownloadUrlTemplate'],
    ]);
  });

  it("F-2206 BR-6: a setting is written to the user's settings", async () => {
    const {operations, asked} = operationsOver();
    await operations.writeUserSetting('remote.SSH.remotePlatform', {
      devbox: 'linux',
    });
    deepStrictEqual(asked.updates, [
      ['remote.SSH.remotePlatform', {devbox: 'linux'}, GLOBAL_TARGET],
    ]);
  });

  it('F-2304: the log is revealed through the channel', () => {
    const {operations, asked} = operationsOver();
    operations.revealLog();
    deepStrictEqual(asked.revealed, 1);
  });
});
