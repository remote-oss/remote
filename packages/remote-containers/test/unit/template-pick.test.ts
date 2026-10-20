import {deepStrictEqual} from 'node:assert';
import type {TemplateMetadataResult} from '../../src/cli/cli-lines.ts';
import type {CatalogueTemplate} from '../../src/authoring/catalogue.ts';
import {
  pickTemplate,
  type TemplateChoice,
  type TemplatePicker,
  type TemplatePickPorts,
} from '../../src/authoring/template-pick.ts';
import type {FolderFacts} from '../../src/authoring/curated-templates.ts';
import {CONTAINERS_INTRODUCTION} from '../../src/surfaces/recovery-presenter.ts';

const PREFIX = 'ghcr.io/devcontainers/templates/';

type Row = TemplatePicker['items'][number];

/** A quick pick that records what the pick sets and lets a row play the user. */
class FakePicker implements TemplatePicker {
  items: readonly Row[] = [];
  activeItems: readonly Row[] = [];
  selectedItems: readonly Row[] = [];
  title: string | undefined = undefined;
  placeholder: string | undefined = undefined;
  value = '';
  matchOnDescription = true;
  matchOnDetail = true;
  ignoreFocusOut = true;
  shown = false;
  hidden = false;
  disposed = false;
  private readonly accepting: Array<() => void> = [];
  private readonly changing: Array<(value: string) => void> = [];
  private readonly hiding: Array<() => void> = [];
  onDidAccept(listener: () => void): void {
    this.accepting.push(listener);
  }
  onDidChangeValue(listener: (value: string) => void): void {
    this.changing.push(listener);
  }
  onDidHide(listener: () => void): void {
    this.hiding.push(listener);
  }
  show(): void {
    this.shown = true;
  }
  hide(): void {
    if (!this.hidden) {
      this.hidden = true;
      this.hiding.forEach(listener => {
        listener();
      });
    }
  }
  dispose(): void {
    this.disposed = true;
  }
  /** The user types `value`. */
  type(value: string): void {
    this.value = value;
    this.changing.forEach(listener => {
      listener(value);
    });
  }
  /** The user accepts the row with `label`. */
  accept(label: string): void {
    const found = this.items.find(each => each.label === label);
    this.selectedItems = found === undefined ? [] : [found];
    this.accepting.forEach(listener => {
      listener();
    });
  }
}

function templateOf(
  part: string,
  name = part,
  owner = 'devcontainers',
): CatalogueTemplate {
  return {
    id: `${PREFIX}${part}`,
    version: '1.0.0',
    name,
    owner,
    options: {},
    optionalPaths: [],
  };
}

const NO_FILES: FolderFacts = {rootEntries: [], files: [], truncated: false};

const SIGNIFICANT: FolderFacts = {
  rootEntries: [],
  files: ['main.go'],
  truncated: false,
};

interface Scene {
  pickers: FakePicker[];
  opened: string[];
  metadataAsked: string[];
  ports: TemplatePickPorts;
}

/** The ports over fakes; `metadata` is what the CLI answers a metadata call. */
function sceneOf(
  metadata: TemplateMetadataResult = {kind: 'metadata', metadata: {field: 1}},
): Scene {
  const scene: Scene = {
    pickers: [],
    opened: [],
    metadataAsked: [],
    ports: {
      createQuickPick: () => {
        const picker = new FakePicker();
        scene.pickers.push(picker);
        return picker;
      },
      verifiedIcon: 'verified-icon',
      openExternal: address => {
        scene.opened.push(address);
      },
      templateMetadata: templateId => {
        scene.metadataAsked.push(templateId);
        return Promise.resolve(metadata);
      },
      templatePrefixes: [PREFIX],
      translate: template => template,
    },
  };
  return scene;
}

/** Starts a pick and gives the first quick pick it makes, with the pick's result. */
function started(
  scene: Scene,
  folder: FolderFacts,
  catalogue: CatalogueTemplate[],
  signal = new AbortController().signal,
): {picker: FakePicker; result: Promise<TemplateChoice>} {
  const result = pickTemplate(
    {title: 'Add Dev Container Configuration Files', folder, catalogue},
    scene.ports,
    signal,
  );
  const [picker] = scene.pickers;
  if (picker === undefined) {
    throw new Error('the pick made no quick pick');
  }
  return {picker, result};
}

/** The labels of the rows. */
function labels(picker: FakePicker): string[] {
  return picker.items.map(each => each.label);
}

const CATALOGUE = [
  templateOf('python', 'Python 3', 'devcontainers'),
  templateOf('alpine', 'Alpine', 'devcontainers'),
  templateOf('other', 'Other', 'someone'),
  templateOf('twin-b', 'Twin', 'devcontainers'),
  templateOf('twin-a', 'Twin', 'devcontainers'),
];

describe('the flat template pick (card containers-79)', () => {
  it('F-0802 AC-2: the title and placeholder are set, and Learn More comes first, then the templates by name with ties in the order they came in', () => {
    const {picker} = started(sceneOf(), NO_FILES, CATALOGUE);
    deepStrictEqual(
      [picker.title, picker.placeholder, picker.shown, labels(picker)],
      [
        'Add Dev Container Configuration Files',
        'Select a container configuration template or enter a custom template id',
        true,
        ['Learn More', 'Alpine', 'Other', 'Python 3', 'Twin', 'Twin'],
      ],
    );
  });

  it('F-0802 AC-2: the ties keep the index order', () => {
    const {picker} = started(sceneOf(), NO_FILES, CATALOGUE);
    deepStrictEqual(
      picker.items
        .filter(each => each.label === 'Twin')
        .map(each =>
          each.action.kind === 'template' ? each.action.template.id : '',
        ),
      [`${PREFIX}twin-b`, `${PREFIX}twin-a`],
    );
  });

  it('F-0802 AC-3: the owner is the description, and only the devcontainers owner has the verified icon', () => {
    const {picker} = started(sceneOf(), NO_FILES, CATALOGUE);
    deepStrictEqual(
      picker.items
        .filter(each => each.action.kind === 'template')
        .map(each => [each.label, each.description, each.iconPath]),
      [
        ['Alpine', 'devcontainers', 'verified-icon'],
        ['Other', 'someone', undefined],
        ['Python 3', 'devcontainers', 'verified-icon'],
        ['Twin', 'devcontainers', 'verified-icon'],
        ['Twin', 'devcontainers', 'verified-icon'],
      ],
    );
  });

  it('F-0802 AC-4: the first template is focused, never Learn More', () => {
    const {picker} = started(sceneOf(), NO_FILES, CATALOGUE);
    deepStrictEqual(
      picker.activeItems.map(each => each.label),
      ['Alpine'],
    );
  });

  it('F-0802 AC-4: with no template at all nothing is focused', () => {
    const {picker} = started(sceneOf(), NO_FILES, []);
    deepStrictEqual(picker.activeItems, []);
  });

  it('F-0802 AC-5: the filter matches labels only, and Learn More stays whatever is typed', () => {
    const {picker} = started(sceneOf(), NO_FILES, CATALOGUE);
    deepStrictEqual(
      [
        picker.matchOnDescription,
        picker.matchOnDetail,
        picker.items.find(each => each.action.kind === 'learnMore')?.alwaysShow,
        picker.items.some(
          each => each.action.kind === 'template' && each.alwaysShow === true,
        ),
      ],
      [false, false, true, false],
    );
  });

  it('F-0802 AC-18: Learn More opens the documentation and ends the pick', async () => {
    const scene = sceneOf();
    const {picker, result} = started(scene, NO_FILES, CATALOGUE);
    picker.accept('Learn More');
    deepStrictEqual(
      [await result, scene.opened],
      [{kind: 'learnMore'}, [CONTAINERS_INTRODUCTION]],
    );
  });

  it('F-0802 AC-2: accepting a template gives it, listed', async () => {
    const {picker, result} = started(sceneOf(), NO_FILES, CATALOGUE);
    picker.accept('Python 3');
    deepStrictEqual(await result, {
      kind: 'listed',
      template: CATALOGUE[0],
    });
  });

  it('F-0802 AC-19: Escape on the first screen cancels', async () => {
    const {picker, result} = started(sceneOf(), NO_FILES, CATALOGUE);
    picker.hide();
    deepStrictEqual(await result, {kind: 'cancelled'});
  });

  it('F-0802 AC-19: the pick is cancelled when its signal aborts, and the quick pick goes away', async () => {
    const controller = new AbortController();
    const {picker, result} = started(
      sceneOf(),
      NO_FILES,
      CATALOGUE,
      controller.signal,
    );
    controller.abort();
    deepStrictEqual(
      [await result, picker.hidden, picker.disposed],
      [{kind: 'cancelled'}, true, true],
    );
  });

  it('F-0802 AC-31: nothing persists between runs: the second pick is the first’s', () => {
    const scene = sceneOf();
    const first = started(scene, NO_FILES, CATALOGUE);
    first.picker.accept('Alpine');
    first.picker.type('a/b/c');
    const second = pickTemplate(
      {title: 'T', folder: NO_FILES, catalogue: CATALOGUE},
      scene.ports,
      new AbortController().signal,
    );
    void second;
    deepStrictEqual(labels(scene.pickers[1] ?? first.picker), [
      'Learn More',
      'Alpine',
      'Other',
      'Python 3',
      'Twin',
      'Twin',
    ]);
  });

  it('F-0802 AC-9: with fewer than two slashes the list stays', () => {
    const {picker} = started(sceneOf(), NO_FILES, CATALOGUE);
    picker.type('ghcr.io/devcontainers');
    deepStrictEqual(labels(picker).length, 6);
  });

  it('F-0802 AC-10: with two slashes the rows are the custom one with the exact value, and Learn More', () => {
    const {picker} = started(sceneOf(), NO_FILES, CATALOGUE);
    picker.type('ghcr.io/me/templates/x');
    deepStrictEqual(
      picker.items.map(each => [each.label, each.detail, each.alwaysShow]),
      [
        [
          "Use 'ghcr.io/me/templates/x' as template...",
          'Apply this custom template instead of one of the listed templates.',
          true,
        ],
        ['Learn More', undefined, true],
      ],
    );
  });

  it('F-0802 AC-10: back under two slashes the previous rows return', () => {
    const {picker} = started(sceneOf(), NO_FILES, CATALOGUE);
    picker.type('a/b/c');
    picker.type('a/b');
    deepStrictEqual(labels(picker).length, 6);
  });

  it('F-0802 AC-11: metadata is asked once, on select, and the custom id is given with it', async () => {
    const scene = sceneOf({kind: 'metadata', metadata: {id: 'x'}});
    const {picker, result} = started(scene, NO_FILES, CATALOGUE);
    picker.type('a/b/c');
    const askedWhileTyping = scene.metadataAsked.length;
    picker.accept("Use 'a/b/c' as template...");
    deepStrictEqual(
      [askedWhileTyping, await result, scene.metadataAsked],
      [
        0,
        {kind: 'custom', templateId: 'a/b/c', metadata: {id: 'x'}},
        ['a/b/c'],
      ],
    );
  });

  it('F-0802 AC-11: a failed metadata call is silent, and the custom id is given without it', async () => {
    const scene = sceneOf({kind: 'configurationFailed', message: 'x'});
    const {picker, result} = started(scene, NO_FILES, CATALOGUE);
    picker.type('a/b/c');
    picker.accept("Use 'a/b/c' as template...");
    deepStrictEqual(await result, {kind: 'custom', templateId: 'a/b/c'});
  });

  it('F-0802 AC-2: accepting nothing leaves the pick open', () => {
    const {picker} = started(sceneOf(), NO_FILES, CATALOGUE);
    picker.accept('no such row');
    deepStrictEqual(picker.hidden, false);
  });
});

describe('the curated template pick (card containers-79)', () => {
  const CURATED = [
    templateOf('alpine', 'Alpine'),
    templateOf('go', 'Go'),
    templateOf('rust', 'Rust'),
    templateOf('ubuntu', 'Ubuntu'),
  ];

  it('F-0802 AC-24: a folder with a significant file shows Show All Templates first, then Learn More, then the curated templates by name', () => {
    const {picker} = started(sceneOf(), SIGNIFICANT, CURATED);
    deepStrictEqual(labels(picker), [
      'Show All Templates...',
      'Learn More',
      'Alpine',
      'Go',
      'Ubuntu',
    ]);
  });

  it('F-0802 AC-24: Show All Templates has its detail and always shows, and focus is on the first template', () => {
    const {picker} = started(sceneOf(), SIGNIFICANT, CURATED);
    const showAll = picker.items[0];
    deepStrictEqual(
      [
        showAll?.detail,
        showAll?.alwaysShow,
        picker.activeItems.map(each => each.label),
      ],
      ['Show all available predefined container templates.', true, ['Alpine']],
    );
  });

  it('F-0802 AC-25: Show All Templates replaces the rows in place with the flat list, focused on its first template, and the pick goes on', () => {
    const {picker} = started(sceneOf(), SIGNIFICANT, CURATED);
    picker.accept('Show All Templates...');
    deepStrictEqual(
      [
        labels(picker),
        picker.activeItems.map(each => each.label),
        picker.hidden,
      ],
      [['Learn More', 'Alpine', 'Go', 'Rust', 'Ubuntu'], ['Alpine'], false],
    );
  });

  it('F-0802 AC-28: custom-id mode in the curated list keeps Show All Templates after the custom row and Learn More', () => {
    const {picker} = started(sceneOf(), SIGNIFICANT, CURATED);
    picker.type('a/b/c');
    deepStrictEqual(labels(picker), [
      "Use 'a/b/c' as template...",
      'Learn More',
      'Show All Templates...',
    ]);
  });

  it('F-0802 AC-30: after Show All Templates the custom-id rows have no Show All, and the flat list returns under two slashes', () => {
    const {picker} = started(sceneOf(), SIGNIFICANT, CURATED);
    picker.accept('Show All Templates...');
    picker.type('a/b/c');
    const custom = labels(picker);
    picker.type('');
    deepStrictEqual(
      [custom, labels(picker)],
      [
        ["Use 'a/b/c' as template...", 'Learn More'],
        ['Learn More', 'Alpine', 'Go', 'Rust', 'Ubuntu'],
      ],
    );
  });

  it('F-0802 AC-26: a folder of neutral files only shows the flat list', () => {
    const {picker} = started(
      sceneOf(),
      {rootEntries: [], files: ['README.md', 'data.json'], truncated: false},
      CURATED,
    );
    deepStrictEqual(labels(picker), [
      'Learn More',
      'Alpine',
      'Go',
      'Rust',
      'Ubuntu',
    ]);
  });
});

describe('the chooser that offers an existing Dockerfile (card containers-79)', () => {
  const WITH_DOCKERFILES: FolderFacts = {
    rootEntries: [
      {name: 'dockerfile', kind: 'file'},
      {name: 'Dockerfile', kind: 'file'},
      {name: 'api.Dockerfile', kind: 'folder'},
      {name: 'nested', kind: 'folder'},
      {name: 'Dockerfile.link', kind: 'other'},
      {name: 'readme.md', kind: 'file'},
    ],
    files: [],
    truncated: false,
  };

  const WITH_EXISTING = [
    ...CATALOGUE,
    templateOf('docker-existing-dockerfile', 'Existing Dockerfile'),
  ];

  it('F-0802 AC-22: the chooser comes first with the template row, a From row for each Dockerfile-family entry by character code, and Learn More', () => {
    const {picker} = started(sceneOf(), WITH_DOCKERFILES, WITH_EXISTING);
    deepStrictEqual(
      [picker.placeholder, labels(picker)],
      [
        'How would you like to create your container configuration?',
        [
          'From a predefined container configuration template...',
          "From 'Dockerfile'",
          "From 'api.Dockerfile'",
          "From 'dockerfile'",
          'Learn More',
        ],
      ],
    );
  });

  it('F-0802 AC-22: the details are the registry’s and the existing file’s, and Learn More has its description', () => {
    const {picker} = started(sceneOf(), WITH_DOCKERFILES, WITH_EXISTING);
    deepStrictEqual(
      picker.items.map(each => [each.detail, each.description]),
      [
        [
          'Use a base configuration from the container template registry',
          undefined,
        ],
        [
          "Refer to the existing 'Dockerfile' in the container configuration",
          undefined,
        ],
        [
          "Refer to the existing 'api.Dockerfile' in the container configuration",
          undefined,
        ],
        [
          "Refer to the existing 'dockerfile' in the container configuration",
          undefined,
        ],
        [undefined, 'Documentation on predefined container templates'],
      ],
    );
  });

  it('F-0802 AC-29: the template row is focused, and the filter matches labels only', () => {
    const {picker} = started(sceneOf(), WITH_DOCKERFILES, WITH_EXISTING);
    deepStrictEqual(
      [
        picker.activeItems.map(each => each.label),
        picker.matchOnDescription,
        picker.matchOnDetail,
        picker.title,
      ],
      [
        ['From a predefined container configuration template...'],
        false,
        false,
        'Add Dev Container Configuration Files',
      ],
    );
  });

  it('F-0802 AC-36: only root entries count, so a folder with no Dockerfile at its root gets the template pick', () => {
    const {picker} = started(
      sceneOf(),
      {
        rootEntries: [{name: 'src', kind: 'folder'}],
        files: ['src/Dockerfile'],
        truncated: false,
      },
      WITH_EXISTING,
    );
    deepStrictEqual(
      picker.placeholder,
      'Select a container configuration template or enter a custom template id',
    );
  });

  it('F-0802 AC-22: a From row gives the existing-Dockerfile template and the entry', async () => {
    const {picker, result} = started(
      sceneOf(),
      WITH_DOCKERFILES,
      WITH_EXISTING,
    );
    picker.accept("From 'api.Dockerfile'");
    deepStrictEqual(await result, {
      kind: 'reuse',
      templateId: `${PREFIX}docker-existing-dockerfile`,
      entry: 'api.Dockerfile',
    });
  });

  it('F-0802 AC-22: a From row with no such template in the catalogue fails the pick with the cause', async () => {
    const {picker, result} = started(sceneOf(), WITH_DOCKERFILES, CATALOGUE);
    picker.accept("From 'Dockerfile'");
    deepStrictEqual(await result, {
      kind: 'failed',
      cause: 'the catalogue has no docker-existing-dockerfile template',
    });
  });

  it('F-0802 AC-22: the template row goes on to the template pick in a quick pick of its own', async () => {
    const scene = sceneOf();
    const {picker, result} = started(scene, WITH_DOCKERFILES, WITH_EXISTING);
    picker.accept('From a predefined container configuration template...');
    await new Promise(resolve => setTimeout(resolve, 0));
    const next = scene.pickers[1];
    next?.accept('Alpine');
    deepStrictEqual(await result, {kind: 'listed', template: CATALOGUE[1]});
  });

  it('F-0802 AC-22: Learn More opens the documentation', async () => {
    const scene = sceneOf();
    const {picker, result} = started(scene, WITH_DOCKERFILES, WITH_EXISTING);
    picker.accept('Learn More');
    deepStrictEqual(
      [await result, scene.opened],
      [{kind: 'learnMore'}, [CONTAINERS_INTRODUCTION]],
    );
  });

  it('F-0802 AC-19: Escape on the chooser cancels', async () => {
    const {picker, result} = started(
      sceneOf(),
      WITH_DOCKERFILES,
      WITH_EXISTING,
    );
    picker.hide();
    deepStrictEqual(await result, {kind: 'cancelled'});
  });

  it('F-0802 AC-22: accepting nothing leaves the chooser open', () => {
    const {picker} = started(sceneOf(), WITH_DOCKERFILES, WITH_EXISTING);
    picker.accept('no such row');
    deepStrictEqual(picker.hidden, false);
  });
});
