import {deepStrictEqual} from 'node:assert';
import type {RootEntry} from '../../src/authoring/curated-templates.ts';
import {
  askLocation,
  type LocationChoice,
  type LocationPorts,
  type LocationRow,
} from '../../src/authoring/location.ts';
import {FakePicker} from './template-picker.fixture.ts';

const NEVER = new AbortController().signal;

const FOLDER = '/home/a/app';

const EXISTS = 'Configuration already exists';
const WORKSPACE = 'Add configuration to workspace';
const USER_DATA = 'Add configuration to user data folder';

/** What the folder and the store hold, for one run of the stage. */
interface Scene {
  root: RootEntry[];
  inside: RootEntry[];
  markers: Record<string, string>;
}

/** Runs the stage over `scene`; `answer` plays the user on the picker, or hides it for Escape. */
async function asked(
  scene: Partial<Scene>,
  answer: (picker: FakePicker<LocationRow>) => void,
  cancellation: AbortSignal = NEVER,
): Promise<{result: LocationChoice; picker: FakePicker<LocationRow>}> {
  const picker = new FakePicker<LocationRow>();
  const markers = scene.markers ?? {};
  const location: LocationPorts = {
    createQuickPick: () => picker,
    storeRoot: '/store/configs',
    store: {
      folderNames: () =>
        Promise.resolve([
          ...new Set(
            Object.keys(markers).map(file =>
              file.slice('/store/configs/'.length).split('/', 1).join(''),
            ),
          ),
        ]),
      readText: file => Promise.resolve(markers[file]),
    },
    home: '/home/a',
  };
  const running = askLocation(
    location,
    {
      title: 'Add Dev Container Configuration Files',
      folder: FOLDER,
      facts: {rootEntries: scene.root ?? [], files: [], truncated: false},
      files: {list: () => Promise.resolve(scene.inside ?? [])},
      translate: template => template,
    },
    cancellation,
  );
  await new Promise(resolve => setTimeout(resolve, 0));
  answer(picker);
  return {result: await running, picker};
}

function markerOf(folder: string): string {
  return `// Maintained by the Dev Container extension\n${JSON.stringify({rootFolder: folder})}\n`;
}

const OWN_MARKER = {
  '/store/configs/app/.devcontainer/.devcontainer-internal.json':
    markerOf('/home/a/app'),
};

describe('the location stage of the wizard (card containers-91)', () => {
  it('F-0801 AC-3: the pick has the title, the placeholder, the two rows with their detail lines, the first focused, and no buttons', async () => {
    const {picker} = await asked({}, each => {
      each.hide();
    });
    deepStrictEqual(
      [
        picker.title,
        picker.placeholder,
        picker.items,
        picker.activeItems.map(each => each.label),
      ],
      [
        'Add Dev Container Configuration Files',
        'Where would you like to create your container configuration?',
        [
          {
            label: WORKSPACE,
            detail:
              'This allows you to share the configuration with others via source control',
            place: 'workspace',
          },
          {
            label: USER_DATA,
            detail:
              'This avoids having outgoing changes in your workspace folder',
            place: 'userData',
          },
        ],
        [WORKSPACE],
      ],
    );
  });

  it('F-0801 AC-3: Escape ends the wizard cancelled, and so does an abort', async () => {
    const escaped = await asked({}, each => {
      each.hide();
    });
    const abort = new AbortController();
    const aborted = await asked(
      {},
      () => {
        abort.abort();
      },
      abort.signal,
    );
    deepStrictEqual(
      [escaped.result, aborted.result],
      [{kind: 'cancelled'}, {kind: 'cancelled'}],
    );
  });

  it('F-0302 AC-30: the workspace row carries "Configuration already exists" for a root .devcontainer.json or a .devcontainer/devcontainer.json, and the user data row for a slot of the folder', async () => {
    const cases: Array<[Partial<Scene>, Array<string | undefined>]> = [
      [{}, [undefined, undefined]],
      [
        {root: [{name: '.devcontainer.json', kind: 'file'}]},
        [EXISTS, undefined],
      ],
      [
        {inside: [{name: 'devcontainer.json', kind: 'file'}]},
        [EXISTS, undefined],
      ],
      [{markers: OWN_MARKER}, [undefined, EXISTS]],
      [
        {
          root: [{name: '.devcontainer.json', kind: 'file'}],
          markers: OWN_MARKER,
        },
        [EXISTS, EXISTS],
      ],
    ];
    const seen: Array<Array<string | undefined>> = [];
    for (const [scene] of cases) {
      const {picker} = await asked(scene, each => {
        each.hide();
      });
      seen.push(picker.items.map(each => each.description));
    }
    deepStrictEqual(
      seen,
      cases.map(([, expected]) => expected),
    );
  });

  it('F-0801 AC-3: a folder or a file of another kind in the places of the configuration does not count as one', async () => {
    const {picker} = await asked(
      {
        root: [{name: '.devcontainer.json', kind: 'folder'}],
        inside: [{name: 'devcontainer.json', kind: 'folder'}],
      },
      each => {
        each.hide();
      },
    );
    deepStrictEqual(
      picker.items.map(each => each.description),
      [undefined, undefined],
    );
  });

  it('F-0801 BR-4: the workspace row gives the workspace target', async () => {
    const {result} = await asked({}, each => {
      each.accept(WORKSPACE);
    });
    deepStrictEqual(result, {kind: 'workspace'});
  });

  it('F-0302 AC-35: the user data row gives the folder’s own slot when it has one', async () => {
    const {result} = await asked({markers: OWN_MARKER}, each => {
      each.accept(USER_DATA);
    });
    deepStrictEqual(result, {kind: 'userData', slot: 'app'});
  });

  it('F-0302 AC-15: the user data row gives a new slot, -2 when the name is taken by another folder', async () => {
    const taken = {
      '/store/configs/app/.devcontainer/.devcontainer-internal.json':
        markerOf('/home/b/app'),
    };
    const fresh = await asked({}, each => {
      each.accept(USER_DATA);
    });
    const collided = await asked({markers: taken}, each => {
      each.accept(USER_DATA);
    });
    deepStrictEqual(
      [
        fresh.result,
        collided.result,
        collided.picker.items.map(each => each.description),
      ],
      [
        {kind: 'userData', slot: 'app'},
        {kind: 'userData', slot: 'app-2'},
        [undefined, undefined],
      ],
    );
  });

  it('F-0801 AC-3: accepting with nothing selected keeps the pick open', async () => {
    const {picker, result} = await asked({}, each => {
      each.accept('nothing');
      each.accept(WORKSPACE);
    });
    deepStrictEqual([picker.hidden, result], [true, {kind: 'workspace'}]);
  });
});
