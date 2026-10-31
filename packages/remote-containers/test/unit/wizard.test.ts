import {deepStrictEqual} from 'node:assert';
import type {CatalogueTemplate} from '../../src/authoring/catalogue.ts';
import type {RootEntry} from '../../src/authoring/curated-templates.ts';
import {
  runWizard,
  walkStages,
  wizardRunnerOf,
} from '../../src/authoring/wizard.ts';
import type {
  StagePorts,
  StageResult,
  WizardPorts,
  WizardStage,
  WizardState,
} from '../../src/authoring/wizard-stages.ts';
import {NO_TEMPLATE, stagesOf} from '../../src/authoring/wizard-stages.ts';
import type {WriteOutcome, WriteRequest} from '../../src/authoring/write.ts';
import type {LocationPorts} from '../../src/authoring/location.ts';
import {
  pick,
  pressBack,
  FINISH_BUTTON,
  pressEscape,
  type Step,
  repeatedInput,
  scriptedInput,
  takeDefaults,
} from './option-picker.fixture.ts';
import {FakeLocationPicker, FakePicker} from './template-picker.fixture.ts';

const NEVER = new AbortController().signal;
const PREFIX = 'ghcr.io/devcontainers/templates/';
const SPECIFICATION = 'https://github.com/devcontainers/templates';

const INITIAL: WizardState = {
  folder: '/work/ws',
  target: {kind: 'workspace'},
  template: NO_TEMPLATE,
  templateArgs: {},
  features: [],
  featureMode: 'defaults',
  omitPaths: [],
};

interface Entry {
  name: string;
  mark: string | undefined;
  kept: string | undefined;
}

/** Walks stages that give the results listed for each name, and reports how each was entered. */
async function walkedOf(
  gives: Array<[string, StageResult[]]>,
): Promise<{walked: Awaited<ReturnType<typeof walkStages>>; entries: Entry[]}> {
  const entries: Entry[] = [];
  const stages = gives.map(([name, results]): WizardStage => ({
    name,
    execute: (state, previous) => {
      entries.push({
        name,
        mark: state.templateArgs.mark,
        kept: previous?.state.templateArgs.mark,
      });
      return Promise.resolve(results.shift() ?? {kind: 'cancelled'});
    },
  }));
  return {walked: await walkStages(stages, INITIAL, NEVER), entries};
}

function marked(mark: string): WizardState {
  return {...INITIAL, templateArgs: {mark}};
}

function next(mark: string, shown = true): StageResult {
  return {kind: 'next', state: marked(mark), shown};
}

const BACK_KEEP: StageResult = {kind: 'back', keep: true};
const BACK_DROP: StageResult = {kind: 'back', keep: false};

describe('the stage runner of the wizard (card containers-80)', () => {
  it('F-0801 BR-5: each stage is entered with the state the one before gave, and the last state ends the walk', async () => {
    const {walked, entries} = await walkedOf([
      ['one', [next('a')]],
      ['two', [next('b')]],
    ]);
    deepStrictEqual(
      [walked, entries.map(each => [each.name, each.mark])],
      [
        {kind: 'state', state: marked('b')},
        [
          ['one', undefined],
          ['two', 'a'],
        ],
      ],
    );
  });

  it('F-0801 BR-5: Back with keep runs the previous shown stage again with the state it was entered with and its last answer', async () => {
    const {walked, entries} = await walkedOf([
      ['one', [next('a'), next('a2')]],
      ['two', [BACK_KEEP, next('b')]],
    ]);
    deepStrictEqual(
      [walked, entries.map(each => [each.name, each.mark, each.kept])],
      [
        {kind: 'state', state: marked('b')},
        [
          ['one', undefined, undefined],
          ['two', 'a', undefined],
          ['one', undefined, 'a'],
          ['two', 'a2', undefined],
        ],
      ],
    );
  });

  it('F-0801 BR-5: Back without keep runs the previous shown stage again with no last answer', async () => {
    const {entries} = await walkedOf([
      ['one', [next('a'), next('a2')]],
      ['two', [BACK_DROP, next('b')]],
    ]);
    deepStrictEqual(
      entries.map(each => [each.name, each.kept]),
      [
        ['one', undefined],
        ['two', undefined],
        ['one', undefined],
        ['two', undefined],
      ],
    );
  });

  it('F-0801 BR-5: Back passes over a stage that showed nothing', async () => {
    const {entries} = await walkedOf([
      ['one', [next('a'), next('a2')]],
      ['quiet', [next('q', false), next('q2', false)]],
      ['three', [BACK_KEEP, next('c')]],
    ]);
    deepStrictEqual(
      entries.map(each => each.name),
      ['one', 'quiet', 'three', 'one', 'quiet', 'three'],
    );
  });

  it('F-0801 BR-5: Back from the first shown stage runs that stage again', async () => {
    const {walked, entries} = await walkedOf([['one', [BACK_DROP, next('a')]]]);
    deepStrictEqual(
      [walked, entries.map(each => each.name)],
      [{kind: 'state', state: marked('a')}, ['one', 'one']],
    );
  });

  it('F-0801 BR-5: a stage that cancels ends the walk with nothing after it run', async () => {
    const {walked, entries} = await walkedOf([
      ['one', [{kind: 'cancelled'}]],
      ['two', [next('b')]],
    ]);
    deepStrictEqual(
      [walked, entries.map(each => each.name)],
      [{kind: 'ended', outcome: {kind: 'cancelled'}}, ['one']],
    );
  });

  it('F-0801 BR-5: a stage that ends the wizard gives its outcome', async () => {
    const {walked} = await walkedOf([
      ['one', [{kind: 'done', outcome: {kind: 'failed', detail: 'why'}}]],
    ]);
    deepStrictEqual(walked, {
      kind: 'ended',
      outcome: {kind: 'failed', detail: 'why'},
    });
  });

  it('F-0801 BR-5: no stage at all gives the initial state', async () => {
    deepStrictEqual((await walkedOf([])).walked, {
      kind: 'state',
      state: INITIAL,
    });
  });
});

function templateOf(
  part: string,
  options: Record<string, unknown> = {},
  optionalPaths: string[] = [],
): CatalogueTemplate {
  return {
    id: `${PREFIX}${part}`,
    version: '1',
    name: part,
    owner: 'devcontainers',
    collectionRepository: SPECIFICATION,
    options,
    optionalPaths,
  };
}

const ALPINE = templateOf(
  'alpine',
  {
    imageVariant: {type: 'string', default: '3.23'},
    flag: {type: 'boolean', default: false},
  },
  ['.github/dependabot.yml'],
);

const INDEX = JSON.stringify({
  collections: [
    {
      sourceInformation: {repository: SPECIFICATION},
      templates: [
        {
          id: `${PREFIX}alpine`,
          version: '1',
          name: 'Alpine',
          options: ALPINE.options,
          optionalPaths: ALPINE.optionalPaths,
        },
        {
          id: `${PREFIX}docker-existing-dockerfile`,
          version: '1',
          name: 'Existing Dockerfile',
        },
      ],
    },
  ],
});

const FLAT_INDEX = JSON.stringify({
  collections: [
    {templates: [{id: `${PREFIX}alpine`, version: '1', name: 'Alpine'}]},
  ],
});

interface Scene {
  pickers: FakePicker[];
  locationPickers: FakeLocationPicker[];
  failures: string[];
  written: WriteRequest[];
  logged: string[];
  files: Map<string, string>;
  writes: Array<[string, string]>;
  ports: WizardPorts;
  outcome: WriteOutcome;
  root: RootEntry[];
}

/** The wizard's ports over fakes; `answer` is what the index download gives. */
function sceneOf(
  download: () => Promise<string> = () => Promise.resolve(INDEX),
): Scene {
  const scene: Scene = {
    pickers: [],
    locationPickers: [],
    failures: [],
    written: [],
    logged: [],
    files: new Map(),
    writes: [],
    outcome: {kind: 'written', files: ['.devcontainer/devcontainer.json']},
    root: [],
    ports: undefined as never,
  };
  scene.ports = {
    catalogue: {
      environment: {},
      download,
      setTimer: () => () => undefined,
    },
    dialogs: {
      showModalError: message => {
        scene.failures.push(message);
        return Promise.resolve(undefined);
      },
    },
    pick: {
      createQuickPick: () => {
        const picker = new FakePicker();
        scene.pickers.push(picker);
        return picker;
      },
      verifiedIcon: 'verified',
      openExternal: () => undefined,
      templateMetadata: () =>
        Promise.resolve({
          kind: 'metadata',
          metadata: {
            options: {size: {type: 'string', default: '3'}},
            optionalPaths: ['a', 2],
          },
        }),
      translate: template => template,
    },
    options: repeatedInput(takeDefaults),
    write: async request => {
      scene.written.push(request);
      await request.adjust?.('/scratch');
      return scene.outcome;
    },
    files: {
      list: () => Promise.resolve(scene.root),
      read: file =>
        Promise.resolve(new TextEncoder().encode(scene.files.get(file) ?? '')),
      write: (file, bytes) => {
        scene.writes.push([file, new TextDecoder().decode(bytes)]);
        return Promise.resolve();
      },
    },
    slotFolder: slot => `/store/configs/${slot}`,
    record: line => {
      scene.logged.push(line);
    },
    translate: template => template,
  };
  return scene;
}

/** Location ports over the scene's picker, with an empty store. */
function locationOf(scene: Scene): LocationPorts {
  return {
    createQuickPick: () => {
      const picker = new FakeLocationPicker();
      scene.locationPickers.push(picker);
      return picker;
    },
    storeRoot: '/store/configs',
    store: {
      folderNames: () => Promise.resolve([]),
      readText: () => Promise.resolve(undefined),
    },
    home: '/store',
  };
}

/** The stages of a catalogue with one template and no Feature, over the ports of `scene`. */
function stagesWithoutFeatures(scene: Scene): ReturnType<typeof stagesOf> {
  return stagesOf({kind: 'catalogue', templates: [ALPINE], features: []}, {
    ...scene.ports,
    title: 'T',
    facts: {rootEntries: [], files: [], truncated: false},
  } satisfies StagePorts);
}

/** Starts the wizard and gives the first quick pick it makes, once the catalogue and the folder were read. */
async function started(scene: Scene): Promise<{
  picker: FakePicker;
  result: ReturnType<typeof runWizard>;
}> {
  const result = runWizard(
    {title: 'Add Dev Container Configuration Files', folder: '/work/ws'},
    scene.ports,
    NEVER,
  );
  await new Promise(resolve => setTimeout(resolve, 0));
  const [picker] = scene.pickers;
  if (picker === undefined) {
    throw new Error('the wizard made no quick pick');
  }
  return {picker, result};
}

/** What the wizard writes when the user types the custom template id `a/b/c` and accepts it. */
async function customWritten(scene: Scene): Promise<WriteRequest[]> {
  const {picker, result} = await started(scene);
  picker.type('a/b/c');
  picker.accept("Use 'a/b/c' as template...");
  await result;
  return scene.written;
}

describe('the wizard (card containers-80)', () => {
  it('F-0801 AC-35: a failed fetch is shown and ends the wizard, with no screen shown first', async () => {
    const scene = sceneOf(() => Promise.reject(new Error('no route')));
    const outcome = await runWizard(
      {title: 'T', folder: '/work/ws'},
      scene.ports,
      NEVER,
    );
    deepStrictEqual(
      [outcome, scene.failures, scene.pickers.length],
      [
        {kind: 'failed', detail: 'no route'},
        [
          "The list of dev container templates couldn't be downloaded: no route",
        ],
        0,
      ],
    );
  });

  it('F-0801 AC-4: a template picked is written into the folder with its defaults, no Features and every optional path left out', async () => {
    const scene = sceneOf();
    const {picker, result} = await started(scene);
    picker.accept('Alpine');
    deepStrictEqual(
      [await result, scene.written],
      [
        {
          kind: 'written',
          files: ['.devcontainer/devcontainer.json'],
          target: '/work/ws',
          place: 'workspace',
        },
        [
          {
            targetFolder: '/work/ws',
            templateId: `${PREFIX}alpine`,
            templateArgs: {imageVariant: '3.23', flag: 'false'},
            features: [],
            omitPaths: ['.github/dependabot.yml'],
          },
        ],
      ],
    );
  });

  it('F-0803 AC-4: the boolean screen of a custom template names it by its metadata’s name, or by its id when the metadata has none', async () => {
    const placeholders: Array<string | undefined> = [];
    for (const metadata of [
      {name: 'Lab', options: {flag: {type: 'boolean'}}},
      {options: {flag: {type: 'boolean'}}},
    ]) {
      const scene = sceneOf();
      const input = scriptedInput([takeDefaults, takeDefaults]);
      scene.ports.options = input.ports;
      scene.ports.pick.templateMetadata = () =>
        Promise.resolve({kind: 'metadata', metadata});
      await customWritten(scene);
      placeholders.push(input.pickers[0]?.placeholder);
    }
    deepStrictEqual(placeholders, [
      "Select the options for the 'Lab' dev container",
      "Select the options for the 'a/b/c' dev container",
    ]);
  });

  it('F-0803 AC-20: Escape on the first option screen cancels the wizard and writes nothing', async () => {
    const scene = sceneOf();
    scene.ports.options = scriptedInput([pressEscape]).ports;
    const {picker, result} = await started(scene);
    picker.accept('Alpine');
    deepStrictEqual([await result, scene.written], [{kind: 'cancelled'}, []]);
  });

  it('F-0803 BR-14: Back from the first option screen runs the template pick again, and the template chosen again is written with the new answers', async () => {
    const scene = sceneOf();
    scene.ports.options = scriptedInput([
      pressBack,
      takeDefaults,
      takeDefaults,
      takeDefaults,
    ]).ports;
    const {picker, result} = await started(scene);
    picker.accept('Alpine');
    await new Promise(resolve => setTimeout(resolve, 0));
    scene.pickers[1]?.accept('Alpine');
    await result;
    deepStrictEqual(
      [scene.pickers.length, scene.written.map(each => each.templateArgs)],
      [2, [{imageVariant: '3.23', flag: 'false'}]],
    );
  });

  it('F-0801 AC-19: Escape on the pick cancels and writes nothing', async () => {
    const scene = sceneOf();
    const {picker, result} = await started(scene);
    picker.hide();
    deepStrictEqual([await result, scene.written], [{kind: 'cancelled'}, []]);
  });

  it('F-0802 AC-18: Learn More ends the wizard as cancelled', async () => {
    const scene = sceneOf();
    const {picker, result} = await started(scene);
    picker.accept('Learn More');
    deepStrictEqual([await result, scene.written], [{kind: 'cancelled'}, []]);
  });

  it('F-0802 AC-11: a custom template id is written with the metadata’s options and optional paths', async () => {
    const scene = sceneOf();
    deepStrictEqual(await customWritten(scene), [
      {
        targetFolder: '/work/ws',
        templateId: 'a/b/c',
        templateArgs: {size: '3'},
        features: [],
        omitPaths: ['a'],
      },
    ]);
  });

  it('F-0802 AC-9: a custom template id whose metadata could not be read is written with no options and no omitted path', async () => {
    const scene = sceneOf();
    scene.ports.pick.templateMetadata = () =>
      Promise.resolve({kind: 'configurationFailed', message: 'x'});
    deepStrictEqual(await customWritten(scene), [
      {
        targetFolder: '/work/ws',
        templateId: 'a/b/c',
        templateArgs: {},
        features: [],
        omitPaths: [],
      },
    ]);
  });

  it('F-0802 AC-22: an existing Dockerfile is referred to: the written configuration is changed to name it when it names another', async () => {
    const scene = sceneOf();
    scene.root = [{name: 'api.Dockerfile', kind: 'file'}];
    scene.files.set(
      '/scratch/.devcontainer/devcontainer.json',
      '{\n  // keep\n  "build": {"dockerfile": "../Dockerfile"}\n}',
    );
    const {picker, result} = await started(scene);
    picker.accept("From 'api.Dockerfile'");
    await result;
    deepStrictEqual(scene.writes, [
      [
        '/scratch/.devcontainer/devcontainer.json',
        '{\n  // keep\n  "build": {"dockerfile": "../api.Dockerfile"}\n}',
      ],
    ]);
  });

  it('F-0802 AC-22: the written configuration is left as it is when it already names the entry', async () => {
    const scene = sceneOf();
    scene.root = [{name: 'Dockerfile', kind: 'file'}];
    scene.files.set(
      '/scratch/.devcontainer/devcontainer.json',
      '{"build": {"dockerfile": "../Dockerfile"}}',
    );
    const {picker, result} = await started(scene);
    picker.accept("From 'Dockerfile'");
    await result;
    deepStrictEqual(scene.writes, []);
  });

  it('F-0802 AC-22: a written configuration with no build gets one that names the entry, and a text that is no object is rewritten as one', async () => {
    const scene = sceneOf();
    scene.root = [{name: 'Dockerfile', kind: 'file'}];
    scene.files.set('/scratch/.devcontainer/devcontainer.json', '[1]');
    const {picker, result} = await started(scene);
    picker.accept("From 'Dockerfile'");
    await result;
    deepStrictEqual(
      scene.writes.map(([, text]) =>
        text.includes('"dockerfile": "../Dockerfile"'),
      ),
      [true],
    );
  });

  it('F-0802 AC-22: a From row with no existing-Dockerfile template in the catalogue fails the wizard with the catalogue failure shown', async () => {
    const scene = sceneOf(() => Promise.resolve(FLAT_INDEX));
    scene.root = [{name: 'Dockerfile', kind: 'file'}];
    const {picker, result} = await started(scene);
    picker.accept("From 'Dockerfile'");
    deepStrictEqual(
      [await result, scene.failures],
      [
        {
          kind: 'failed',
          detail: 'the catalogue has no docker-existing-dockerfile template',
        },
        [
          "The list of dev container templates couldn't be downloaded: the catalogue has no docker-existing-dockerfile template",
        ],
      ],
    );
  });

  it('F-0801 AC-30: a write that failed or was cancelled is the wizard’s outcome', async () => {
    const failed = sceneOf();
    failed.outcome = {kind: 'failed', detail: 'read-only'};
    const first = await started(failed);
    first.picker.accept('Alpine');
    const cancelled = sceneOf();
    cancelled.outcome = {kind: 'cancelled'};
    const second = await started(cancelled);
    second.picker.accept('Alpine');
    deepStrictEqual(
      [await first.result, await second.result],
      [{kind: 'failed', detail: 'read-only'}, {kind: 'cancelled'}],
    );
  });

  it('F-0802 BR-14: with no specification collection the log says so once and the flat list shows', async () => {
    const scene = sceneOf(() => Promise.resolve(FLAT_INDEX));
    const {picker} = await started(scene);
    deepStrictEqual(
      [scene.logged, picker.items.map(each => each.label)],
      [
        [
          'the catalogue has no specification template collection; the flat list is shown',
        ],
        ['Learn More', 'Alpine'],
      ],
    );
  });

  it('F-0801 BR-5: the stage list is the template pick, the template’s options, Select Features and the Features’ options', () => {
    const scene = sceneOf();
    const stages = stagesWithoutFeatures(scene);
    deepStrictEqual(
      stages.map(each => each.name),
      ['templatePick', 'templateOptions', 'selectFeatures', 'featureOptions'],
    );
  });

  /** The Select Features stage over a catalogue of one Feature, with the screen played by `step`. */
  function featuresStageOver(step: Step) {
    const scene = sceneOf();
    scene.ports.options = scriptedInput([step]).ports;
    const stages = stagesOf(
      {
        kind: 'catalogue',
        templates: [ALPINE],
        features: [
          {
            id: 'ghcr.io/x/features/git',
            version: '1.3.2',
            name: 'Git',
            options: {},
          },
        ],
      },
      {
        ...scene.ports,
        title: 'T',
        facts: {rootEntries: [], files: [], truncated: false},
      } satisfies StagePorts,
    );
    return stages[2];
  }

  it('F-0804 BR-7, AC-16: Back from Select Features goes back with nothing kept, and Escape cancels the wizard', async () => {
    deepStrictEqual(
      [
        await featuresStageOver(pressBack)?.execute(INITIAL, undefined, NEVER),
        await featuresStageOver(pressEscape)?.execute(
          INITIAL,
          undefined,
          NEVER,
        ),
      ],
      [{kind: 'back', keep: false}, {kind: 'cancelled'}],
    );
  });

  it('F-0804 BR-9: Back from a later stage with keep opens Select Features with the Features checked before', async () => {
    const seen: string[][] = [];
    const stage = featuresStageOver(picker => {
      seen.push(picker.selectedItems.map(each => each.label));
      pressEscape(picker);
    });
    await stage?.execute(
      INITIAL,
      {
        state: {
          ...INITIAL,
          features: [{id: 'ghcr.io/x/features/git:1', options: {}}],
        },
      },
      NEVER,
    );
    deepStrictEqual(seen, [['Git']]);
  });

  it('F-0804 BR-8, BR-11, AC-5: the Features checked and the mode of the button are in the state, and the write takes the Features in order', async () => {
    const scene = sceneOf();
    scene.ports.options = scriptedInput([
      picker => {
        picker.selectedItems = picker.items;
        picker.trigger(FINISH_BUTTON);
      },
    ]).ports;
    scene.ports.catalogue.download = () =>
      Promise.resolve(
        JSON.stringify({
          collections: [
            {
              templates: [
                {id: `${PREFIX}alpine`, version: '1', name: 'Alpine'},
              ],
              features: [
                {id: 'ghcr.io/x/features/git', version: '1.3.2', name: 'Git'},
              ],
            },
          ],
        }),
      );
    const {picker, result} = await started(scene);
    picker.accept('Alpine');
    await result;
    deepStrictEqual(
      scene.written.map(each => each.features),
      [[{id: 'ghcr.io/x/features/git:1', options: {}}]],
    );
  });

  /** A catalogue with an Alpine template and the Feature `Lab Options`, which declares a boolean and an enum. */
  function labCatalogue(): string {
    return JSON.stringify({
      collections: [
        {
          templates: [{id: `${PREFIX}alpine`, version: '1', name: 'Alpine'}],
          features: [
            {
              id: 'ghcr.io/x/features/lab',
              version: '1.0.0',
              name: 'Lab Options',
              options: {
                enabled: {type: 'boolean', default: true},
                level: {type: 'string', enum: ['low', 'high'], default: 'low'},
              },
            },
          ],
        },
      ],
    });
  }

  /** Runs the wizard over the lab catalogue to its end, the Features' screens played by `steps`. */
  async function ranOverLab(steps: Step[]) {
    const scene = sceneOf();
    const input = scriptedInput(steps);
    scene.ports.options = input.ports;
    scene.ports.catalogue.download = () => Promise.resolve(labCatalogue());
    const {picker, result} = await started(scene);
    picker.accept('Alpine');
    await result;
    return {scene, input};
  }

  it('F-0803 AC-11, BR-5: OK on Select Features with a Feature that declares options asks Keep Defaults or Configure Options, and Keep Defaults writes the Feature as {}', async () => {
    const {scene, input} = await ranOverLab([
      picker => {
        picker.acceptChecked(['Lab Options']);
      },
      pick('Keep Defaults'),
    ]);
    deepStrictEqual(
      [scene.written.map(each => each.features), input.pickers[1]?.title],
      [
        [[{id: 'ghcr.io/x/features/lab:1', options: {}}]],
        'Keep Feature defaults or configure options?',
      ],
    );
  });

  it('F-0803 AC-25, BR-14: Back in the Features’ walk reopens Select Features with nothing checked', async () => {
    const {input} = await ranOverLab([
      picker => {
        picker.acceptChecked(['Lab Options']);
      },
      pick('Configure Options'),
      pressBack,
      pressEscape,
    ]);
    deepStrictEqual(
      [
        input.pickers.map(each => each.title),
        input.pickers[3]?.selectedItems.length,
      ],
      [
        [
          'Select Features',
          'Keep Feature defaults or configure options?',
          "Select boolean options for 'Lab Options'",
          'Select Features',
        ],
        0,
      ],
    );
  });

  it('F-0803 BR-8: a Feature the catalogue does not list keeps its entry and asks nothing', async () => {
    const scene = sceneOf();
    const input = scriptedInput([]);
    scene.ports.options = input.ports;
    const stages = stagesWithoutFeatures(scene);
    const result = await stages[3]?.execute(
      {
        ...INITIAL,
        features: [{id: 'ghcr.io/x/features/gone:1', options: {}}],
        featureMode: 'configure',
      },
      undefined,
      NEVER,
    );
    deepStrictEqual(
      [result?.kind === 'next' && result.state.features, input.pickers.length],
      [[{id: 'ghcr.io/x/features/gone:1', options: {}}], 0],
    );
  });

  it('F-0801 BR-5: with the location ports the location stage runs before the template pick', () => {
    const scene = sceneOf();
    const stages = stagesOf(
      {kind: 'catalogue', templates: [ALPINE], features: []},
      {
        ...scene.ports,
        location: locationOf(scene),
        title: 'T',
        facts: {rootEntries: [], files: [], truncated: false},
      } satisfies StagePorts,
    );
    deepStrictEqual(
      stages.map(each => each.name),
      [
        'location',
        'templatePick',
        'templateOptions',
        'selectFeatures',
        'featureOptions',
      ],
    );
  });

  it('F-0302 AC-4: a write to the user data target gets the display path with ~ and then the marker of the folder, and the workspace target gets neither', async () => {
    const userData = sceneOf();
    userData.ports = {...userData.ports, location: locationOf(userData)};
    const first = runWizard(
      {title: 'T', folder: '/home/a/ws'},
      userData.ports,
      NEVER,
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    userData.locationPickers[0]?.accept(
      'Add configuration to user data folder',
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    userData.pickers[0]?.accept('Alpine');
    await first;
    const workspace = sceneOf();
    const second = runWizard(
      {title: 'T', folder: '/home/a/ws'},
      workspace.ports,
      NEVER,
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    workspace.pickers[0]?.accept('Alpine');
    await second;
    deepStrictEqual(
      [
        userData.written.map(each => each.displayPath?.('x/y.json')),
        userData.writes,
        workspace.written.map(each => each.displayPath),
        workspace.writes,
      ],
      [
        ['~/configs/ws/x/y.json'],
        [
          [
            '/store/configs/ws/.devcontainer/.devcontainer-internal.json',
            '// Maintained by the Dev Container extension\n{"rootFolder":"/home/a/ws"}\n',
          ],
        ],
        [undefined],
        [],
      ],
    );
  });

  it('F-0801 AC-3: Escape on the location pick cancels the wizard before any template is asked', async () => {
    const scene = sceneOf();
    scene.ports = {...scene.ports, location: locationOf(scene)};
    const result = runWizard(
      {title: 'T', folder: '/home/a/ws'},
      scene.ports,
      NEVER,
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    scene.locationPickers[0]?.hide();
    deepStrictEqual(
      [await result, scene.pickers.length, scene.written.length],
      [{kind: 'cancelled'}, 0, 0],
    );
  });

  it('F-0302 AC-35: a user data write that was cancelled or failed writes no marker', async () => {
    const scene = sceneOf();
    scene.outcome = {kind: 'cancelled'};
    const result = runWizard(
      {
        title: 'T',
        folder: '/home/a/ws',
        target: {kind: 'userData', slot: 'ws'},
      },
      scene.ports,
      NEVER,
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    scene.pickers[0]?.accept('Alpine');
    deepStrictEqual([await result, scene.writes], [{kind: 'cancelled'}, []]);
  });

  it('F-0801 BR-5: a request aimed at a slot of the store writes into that slot’s folder', async () => {
    const scene = sceneOf();
    const result = runWizard(
      {title: 'T', folder: '/work/ws', target: {kind: 'userData', slot: 'one'}},
      scene.ports,
      NEVER,
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    scene.pickers[0]?.accept('Alpine');
    deepStrictEqual(
      [await result, scene.written.map(each => each.targetFolder)],
      [
        {
          kind: 'written',
          files: ['.devcontainer/devcontainer.json'],
          target: '/store/configs/one',
          place: 'userData',
        },
        ['/store/configs/one'],
      ],
    );
  });

  it('F-0801 AC-1: the runner the commands use titles the pick S024 and writes into the folder it is given', async () => {
    const scene = sceneOf();
    const result = wizardRunnerOf(scene.ports)('/work/ws');
    await new Promise(resolve => setTimeout(resolve, 0));
    const [picker] = scene.pickers;
    picker?.accept('Alpine');
    deepStrictEqual(
      [picker?.title, (await result).kind, scene.written.length],
      ['Add Dev Container Configuration Files', 'written', 1],
    );
  });
});
