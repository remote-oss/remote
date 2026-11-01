import {deepStrictEqual} from 'node:assert';
import {
  copyStored,
  type CopyStoredPorts,
} from '../../src/authoring/copy-stored.ts';
import type {StoredSlot} from '../../src/authoring/user-data-store.ts';

const SLOT: StoredSlot = {
  name: 'app',
  folder: '/store/configs/app',
  configFile: '/store/configs/app/.devcontainer/devcontainer.json',
};
const FOLDER = '/work/app';
const TARGET = '/work/app/.devcontainer/devcontainer.json';
const BYTES = new Uint8Array([0xef, 0xbb, 0xbf, 123, 125, 13, 10]);

/** What a row steers and what the fakes recorded. */
interface Scene {
  /** Whether the workspace already holds the file. */
  existing: boolean;
  /** What the dialogs answer, in order; none for Escape. */
  answers: Array<string | undefined>;
  /** Makes the write fail with this message. */
  failure: string | undefined;
  shown: Array<[string, string, string, readonly string[]]>;
  calls: string[];
  written: Array<[string, Uint8Array]>;
}

function sceneOf(): Scene {
  return {
    existing: false,
    answers: [],
    failure: undefined,
    shown: [],
    calls: [],
    written: [],
  };
}

function portsOf(scene: Scene): CopyStoredPorts {
  return {
    files: {
      exists: file => {
        scene.calls.push(`exists ${file}`);
        return Promise.resolve(scene.existing);
      },
      read: file => {
        scene.calls.push(`read ${file}`);
        return Promise.resolve(BYTES);
      },
      write: (file, bytes) => {
        if (scene.failure !== undefined) {
          return Promise.reject(new Error(scene.failure));
        }
        scene.written.push([file, bytes]);
        scene.calls.push(`write ${file}`);
        return Promise.resolve();
      },
      makeFolder: folder => {
        scene.calls.push(`makeFolder ${folder}`);
        return Promise.resolve();
      },
      removeFolder: folder => {
        scene.calls.push(`removeFolder ${folder}`);
        return Promise.resolve();
      },
    },
    show: (severity, message, detail, buttons) => {
      scene.shown.push([severity, message, detail, buttons]);
      return Promise.resolve(scene.answers.shift());
    },
    translate: template => template,
  };
}

const S108 = 'Delete the configuration from the user data folder?';
const KEPT = {
  kind: 'written',
  files: [],
  target: SLOT.folder,
  place: 'userData',
};

describe('Copy existing configuration to workspace (card containers-92)', () => {
  it('F-0302 AC-7, AC-8: with no file in the workspace the stored file is written byte for byte and then S108 asks Delete, Cancel or Keep with Keep primary', async () => {
    const scene = sceneOf();
    scene.answers = ['Keep'];
    const outcome = await copyStored(
      {folder: FOLDER, slot: SLOT},
      portsOf(scene),
    );
    deepStrictEqual(
      [outcome, scene.written, scene.shown, scene.calls],
      [
        KEPT,
        [[TARGET, BYTES]],
        [['info', S108, '', ['Keep', 'Delete', 'Cancel']]],
        [
          `exists ${TARGET}`,
          `read ${SLOT.configFile}`,
          'makeFolder /work/app/.devcontainer',
          `write ${TARGET}`,
        ],
      ],
    );
  });

  it('F-0302 AC-9, AC-38: Delete removes the whole slot folder and gives the workspace file', async () => {
    const scene = sceneOf();
    scene.answers = ['Delete'];
    const outcome = await copyStored(
      {folder: FOLDER, slot: SLOT},
      portsOf(scene),
    );
    deepStrictEqual(
      [outcome, scene.calls.at(-1)],
      [
        {
          kind: 'written',
          files: ['.devcontainer/devcontainer.json'],
          target: FOLDER,
          place: 'workspace',
        },
        `removeFolder ${SLOT.folder}`,
      ],
    );
  });

  it('F-0302 AC-10, BR-8: Cancel and Escape keep both files like Keep', async () => {
    const outcomes = [];
    const calls = [];
    for (const answer of ['Cancel', undefined]) {
      const scene = sceneOf();
      scene.answers = [answer];
      outcomes.push(
        await copyStored({folder: FOLDER, slot: SLOT}, portsOf(scene)),
      );
      calls.push(scene.calls.filter(call => call.startsWith('removeFolder')));
    }
    deepStrictEqual(
      [outcomes, calls],
      [
        [KEPT, KEPT],
        [[], []],
      ],
    );
  });

  it('F-0801 AC-8: a file in the workspace is asked about first by .devcontainer/devcontainer.json with Skip primary, and Overwrite goes on to S108', async () => {
    const scene = sceneOf();
    scene.existing = true;
    scene.answers = ['Overwrite', 'Keep'];
    const outcome = await copyStored(
      {folder: FOLDER, slot: SLOT},
      portsOf(scene),
    );
    deepStrictEqual(
      [
        outcome,
        scene.shown.map(each => [each[1], each[3]]),
        scene.written.length,
      ],
      [
        KEPT,
        [
          [
            "File '.devcontainer/devcontainer.json' already exists, overwrite?",
            ['Skip', 'Overwrite', 'Cancel'],
          ],
          [S108, ['Keep', 'Delete', 'Cancel']],
        ],
        1,
      ],
    );
  });

  it('F-0801 AC-8: Skip, Cancel and Escape on the question end it with nothing written and no S108', async () => {
    const results = [];
    for (const answer of ['Skip', 'Cancel', undefined]) {
      const scene = sceneOf();
      scene.existing = true;
      scene.answers = [answer];
      results.push([
        await copyStored({folder: FOLDER, slot: SLOT}, portsOf(scene)),
        scene.written.length,
        scene.shown.length,
      ]);
    }
    deepStrictEqual(results, [
      [{kind: 'cancelled'}, 0, 1],
      [{kind: 'cancelled'}, 0, 1],
      [{kind: 'cancelled'}, 0, 1],
    ]);
  });

  it('F-0302 AC-7: a write rejected with a text fails with that text', async () => {
    const scene = sceneOf();
    const ports = portsOf(scene);
    const outcome = await copyStored(
      {folder: FOLDER, slot: SLOT},
      {
        ...ports,
        files: {
          ...ports.files,
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the row feeds a rejection that is not an Error
          write: () => Promise.reject('no space'),
        },
      },
    );
    deepStrictEqual(outcome, {kind: 'failed', detail: 'no space'});
  });

  it('F-0302 AC-7: a copy that cannot be written says so in an error dialog with no button, asks nothing more, and fails', async () => {
    const scene = sceneOf();
    scene.failure = 'disk full';
    const outcome = await copyStored(
      {folder: FOLDER, slot: SLOT},
      portsOf(scene),
    );
    deepStrictEqual(
      [outcome, scene.shown],
      [
        {kind: 'failed', detail: 'disk full'},
        [
          [
            'error',
            "The configuration couldn't be written to /work/app: disk full",
            '',
            [],
          ],
        ],
      ],
    );
  });
});
