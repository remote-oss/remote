import {deepStrictEqual} from 'node:assert';
import type {WizardOutcome} from '../../src/authoring/wizard-stages.ts';
import {
  addConfiguration,
  createDevContainerFile,
  type CreateFilePorts,
} from '../../src/authoring/create-file.ts';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {linesOf} from './reopen.fixture.ts';

const WRITTEN: WizardOutcome = {
  kind: 'written',
  files: ['README.md', '.devcontainer/devcontainer.json'],
  target: '/w/p',
};

interface Scene {
  calls: string[];
  ports: CreateFilePorts;
  sink: MemorySink;
}

/** The command's ports over fakes: the modal answers `answer`, the wizard ends with `outcome`. */
function sceneOf(
  outcome: WizardOutcome,
  answer: string | null = null,
  folders: Array<{scheme: string; fsPath: string}> = [
    {scheme: 'file', fsPath: '/w/p'},
  ],
): Scene {
  const calls: string[] = [];
  const sink = new MemorySink();
  return {
    calls,
    sink,
    ports: {
      window: {folders: () => folders},
      showModal: (message, buttons) => {
        calls.push(`modal ${message} ${buttons.join('|')}`);
        return Promise.resolve(answer ?? undefined);
      },
      openFolder: () => {
        calls.push('openFolder');
        return Promise.resolve();
      },
      wizard: folder => {
        calls.push(`wizard ${folder}`);
        return Promise.resolve(outcome);
      },
      openPreview: file => {
        calls.push(`preview ${file}`);
        return Promise.resolve();
      },
      offerReopen: () => {
        calls.push('offerReopen');
      },
      translate: template => template,
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
    },
  };
}

describe('the Add Dev Container Configuration Files command (card containers-80)', () => {
  it('F-0801 AC-4: after a write the configuration opens in a preview and the reopen notification is offered', async () => {
    const scene = sceneOf(WRITTEN);
    await createDevContainerFile(scene.ports)();
    deepStrictEqual(scene.calls, [
      'wizard /w/p',
      'preview /w/p/.devcontainer/devcontainer.json',
      'offerReopen',
    ]);
  });

  it('F-0801 AC-4: a write with no configuration file among its paths only offers the notification', async () => {
    const scene = sceneOf({...WRITTEN, files: ['README.md']});
    await createDevContainerFile(scene.ports)();
    deepStrictEqual(scene.calls, ['wizard /w/p', 'offerReopen']);
  });

  for (const outcome of [
    {kind: 'cancelled'},
    {kind: 'failed', detail: 'x'},
  ] as const) {
    it(`F-0801 AC-19: a wizard that ended ${outcome.kind} opens nothing and offers nothing`, async () => {
      const scene = sceneOf(outcome);
      await createDevContainerFile(scene.ports)();
      deepStrictEqual(scene.calls, ['wizard /w/p']);
    });
  }

  it('F-0801 AC-2: with no folder open the modal S263 offers Open Folder, which runs core’s command', async () => {
    const scene = sceneOf(WRITTEN, 'Open Folder', []);
    await createDevContainerFile(scene.ports)();
    deepStrictEqual(scene.calls, [
      'modal Open a folder to create the configuration files in first. Open Folder',
      'openFolder',
    ]);
  });

  it('F-0801 AC-15: Cancel on the modal does nothing more', async () => {
    const scene = sceneOf(WRITTEN, null, []);
    await createDevContainerFile(scene.ports)();
    deepStrictEqual(scene.calls.length, 1);
  });

  it('F-0801 AC-1: a window of several folders, or of one that is not a file, does nothing and says so', async () => {
    const several = sceneOf(WRITTEN, null, [
      {scheme: 'file', fsPath: '/a'},
      {scheme: 'file', fsPath: '/b'},
    ]);
    const remote = sceneOf(WRITTEN, null, [
      {scheme: 'vscode-vfs', fsPath: '/a'},
    ]);
    await createDevContainerFile(several.ports)();
    await createDevContainerFile(remote.ports)();
    deepStrictEqual(
      [several.calls, remote.calls, linesOf(several.sink).length],
      [[], [], 1],
    );
  });

  it('F-0801 BR-1: a call made while another runs returns at once', async () => {
    const scene = sceneOf(WRITTEN);
    const releases: Array<(outcome: WizardOutcome) => void> = [];
    scene.ports.wizard = () =>
      new Promise(resolve => {
        releases.push(resolve);
      });
    const handler = createDevContainerFile(scene.ports);
    const first = handler();
    await handler();
    releases[0]?.(WRITTEN);
    await first;
    deepStrictEqual(
      linesOf(scene.sink).filter(line => line.includes('already running'))
        .length,
      1,
    );
  });

  it('F-0301 7.E2: the continuation runs the wizard for the folder it is given, and gives the outcome', async () => {
    const scene = sceneOf(WRITTEN);
    deepStrictEqual(await addConfiguration(scene.ports, '/w/q'), WRITTEN);
  });
});
