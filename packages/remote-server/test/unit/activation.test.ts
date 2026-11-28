import {deepStrictEqual} from 'node:assert';
import type {CommandHost} from 'lib-identifiers';
import type {StandDownHost} from 'lib-standdown';
import {activateTunnels} from '../../src/activation.ts';
import {RUNTIME_COMMAND_IDS} from '../../src/commands.ts';
import {commands, standDown} from '../../src/identifiers.generated.ts';

const OTHER = 'ms-vscode.remote-server';
const STANDING_KEY = 'remote-tunnels.standingDown';

/** A window whose other extension runs or not, and what activation did in it. */
interface Scene {
  contexts: Array<[string, boolean]>;
  warnings: Array<[string, string]>;
  revealed: string[];
  registered: Map<string, () => unknown>;
  disposed: string[];
  opened: number;
  inputs: Parameters<typeof activateTunnels>[0];
}

function sceneOf(otherRunning: boolean, choice?: string): Scene {
  const scene: Scene = {
    contexts: [],
    warnings: [],
    revealed: [],
    registered: new Map(),
    disposed: [],
    opened: 0,
    inputs: undefined as unknown as Scene['inputs'],
  };
  const host: StandDownHost = {
    isRunning: extensionId => otherRunning && extensionId === OTHER,
    setContext: (contextKey, value) => {
      scene.contexts.push([contextKey, value]);
      return Promise.resolve();
    },
    showWarning: (text, button) => {
      scene.warnings.push([text, button]);
      return Promise.resolve(choice);
    },
    revealExtension: extensionId => {
      scene.revealed.push(extensionId);
      return Promise.resolve();
    },
  };
  const commandHost: CommandHost = {
    registerCommand: (commandId, callback) => {
      scene.registered.set(commandId, callback);
      return {
        dispose: () => {
          scene.disposed.push(commandId);
        },
      };
    },
    showOutOfContext: () => undefined,
  };
  scene.inputs = {
    table: {commands, standDown},
    standDownTexts: {warning: 'stays inactive', button: 'Show it'},
    standDown: host,
    commands: commandHost,
    openChannel: () => {
      scene.opened += 1;
    },
  };
  return scene;
}

describe('the activation of Remote - Tunnels (card #3339)', () => {
  it('F-8001 AC-14, AC-4 of F-8901: with the other extension running it sets the key, shows one warning with one button, registers no command and opens no channel', async () => {
    const scene = sceneOf(true);
    const result = await activateTunnels(scene.inputs);
    deepStrictEqual(
      [
        result.kind,
        scene.contexts,
        scene.warnings,
        [...scene.registered.keys()],
        scene.opened,
      ],
      [
        'standing',
        [[STANDING_KEY, true]],
        [['stays inactive', 'Show it']],
        [],
        0,
      ],
    );
  });

  it('F-8001 AC-15: the button opens the other extension in the Extensions view, and closing the warning does nothing', async () => {
    const pressed = sceneOf(true, 'Show it');
    await activateTunnels(pressed.inputs);
    const closed = sceneOf(true, undefined);
    await activateTunnels(closed.inputs);
    await new Promise(resolve => setImmediate(resolve));
    deepStrictEqual([pressed.revealed, closed.revealed], [[OTHER], []]);
  });

  it('F-8001 AC-23: with the other extension absent it clears a key an earlier run left set, shows no warning and registers the six commands then the runtime ones, opening no channel', async () => {
    const scene = sceneOf(false);
    const result = await activateTunnels(scene.inputs);
    deepStrictEqual(
      [
        result.kind,
        scene.contexts,
        scene.warnings,
        [...scene.registered.keys()],
        scene.opened,
      ],
      [
        'serving',
        [[STANDING_KEY, false]],
        [],
        [
          ...Object.values(commands).map(each => each.id),
          ...RUNTIME_COMMAND_IDS,
        ],
        0,
      ],
    );
  });

  it('F-8001 AC-6: the first command or request opens the Output channel, each of the fifteen does, and none registered before', async () => {
    const scene = sceneOf(false);
    await activateTunnels(scene.inputs);
    const before = scene.opened;
    for (const callback of scene.registered.values()) {
      await callback();
    }
    deepStrictEqual([before, scene.opened], [0, scene.registered.size]);
  });

  it('F-8001 AC-16: ending the activation unregisters every command it registered', async () => {
    const scene = sceneOf(false);
    const result = await activateTunnels(scene.inputs);
    if (result.kind === 'serving') {
      result.dispose();
    }
    deepStrictEqual(scene.disposed.sort(), [...scene.registered.keys()].sort());
  });
});
