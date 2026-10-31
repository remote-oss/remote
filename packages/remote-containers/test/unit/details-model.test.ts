import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  detailsTreeOf,
  type DetailsRow,
  type ShownContainer,
  shownContainerOf,
} from '../../src/explorer/details-model.ts';

const RECORDED = readFileSync(
  path.join(
    import.meta.dirname,
    '..',
    'fixtures',
    'docker-inspect-details.json',
  ),
  'utf8',
);

const FOLDER = '/work/proj';
const CONFIG = '/work/proj/.devcontainer/devcontainer.json';

/** A dev container bound to a folder, with the cache volume and the workspace bind. */
const BOUND: ShownContainer = {
  id: 'a'.repeat(64),
  name: '/happy_euler',
  image: 'debian:12',
  labels: {
    'devcontainer.local_folder': FOLDER,
    'devcontainer.config_file': CONFIG,
  },
  mounts: [
    {type: 'volume', name: 'vscode', destination: '/vscode'},
    {type: 'bind', source: FOLDER, destination: '/workspaces/proj'},
  ],
};

function identity(template: string): string {
  return template;
}

/** The rows as `label: description`, nested. */
function shapeOf(rows: readonly DetailsRow[]): unknown[] {
  return rows.map(entry =>
    entry.children.length === 0
      ? `${entry.label}: ${entry.description}`
      : {[entry.label]: shapeOf(entry.children)},
  );
}

/** Every entry of `rows` and below, flat. */
function flat(rows: readonly DetailsRow[]): DetailsRow[] {
  return rows.flatMap(entry => [entry, ...flat(entry.children)]);
}

describe('the Details tree (card containers-33)', () => {
  it('F-0903 AC-1: a bind-mounted dev container is titled with its folder and shows Attributes and Mounts', () => {
    const tree = detailsTreeOf(BOUND, identity);
    deepStrictEqual(
      [tree.title, shapeOf(tree.sections)],
      [
        'proj',
        [
          {
            Attributes: [
              `Workspace: ${FOLDER}`,
              'Name: /happy_euler',
              'Image: debian:12',
              `Configuration: ${CONFIG}`,
            ],
          },
          {
            Mounts: [
              {'Volume mount': ['Volume: vscode', 'Destination: /vscode']},
              {
                'Bind mount': [
                  `Source: ${FOLDER}`,
                  'Destination: /workspaces/proj',
                ],
              },
            ],
          },
        ],
      ],
    );
  });

  it('F-0903 BR-1: the title is the folder’s name, else the repository’s name without .git, else the image reference', () => {
    const titles = [
      {'devcontainer.local_folder': '/tmp/x'},
      {'vsch.local.folder': '/tmp/legacy/'},
      {'vsch.local.repository': 'git://host/path/name.git'},
      {'devcontainer.config_file': '/tmp/y/devcontainer.json'},
      {},
    ].map(
      labels =>
        detailsTreeOf({...BOUND, labels, image: 'img:1'}, identity).title,
    );
    deepStrictEqual(titles, ['x', 'legacy', 'name', 'img:1', 'img:1']);
  });

  it('F-0903 BR-2, BR-3, AC-33: the Configuration entry is there only with the config label, as the bare path, whatever else the labels say', () => {
    const rows = [
      {'devcontainer.local_folder': '/tmp/x'},
      {'devcontainer.config_file': '/tmp/y/devcontainer.json'},
    ].map(labels =>
      flat(detailsTreeOf({...BOUND, labels}, identity).sections)
        .filter(entry => entry.label === 'Configuration')
        .map(entry => entry.description),
    );
    deepStrictEqual(rows, [[], ['/tmp/y/devcontainer.json']]);
  });

  it('F-0903 AC-33, §11: the Workspace origin row is first in Attributes, from the folder label, and a container without a folder label has no origin row; the Workspace text is an [adaptation] key of its own', () => {
    function attributes(labels: Record<string, string>): string[] {
      return flat(detailsTreeOf({...BOUND, labels}, identity).sections)
        .filter(entry => entry.id.startsWith('attributes/'))
        .map(entry => `${entry.label}: ${entry.description}`);
    }
    deepStrictEqual(
      [
        attributes({
          'devcontainer.local_folder': '/tmp/x',
          'devcontainer.config_file': '/tmp/y/devcontainer.json',
        }),
        attributes({'devcontainer.local_folder': '/tmp/x'}),
        attributes({'vsch.local.folder': '/tmp/legacy'}),
        attributes({'devcontainer.config_file': '/tmp/y/devcontainer.json'}),
        attributes({}),
      ],
      [
        [
          'Workspace: /tmp/x',
          'Name: /happy_euler',
          'Image: debian:12',
          'Configuration: /tmp/y/devcontainer.json',
        ],
        ['Workspace: /tmp/x', 'Name: /happy_euler', 'Image: debian:12'],
        ['Workspace: /tmp/legacy', 'Name: /happy_euler', 'Image: debian:12'],
        [
          'Name: /happy_euler',
          'Image: debian:12',
          'Configuration: /tmp/y/devcontainer.json',
        ],
        ['Name: /happy_euler', 'Image: debian:12'],
      ],
    );
  });

  it('F-0903 AC-10: F-0903 BR-9: a container with no mount has no Mounts section', () => {
    deepStrictEqual(
      detailsTreeOf({...BOUND, mounts: []}, identity).sections.map(
        section => section.label,
      ),
      ['Attributes'],
    );
  });

  it('F-0903 AC-36: the image is the reference the container was created with', () => {
    const image = `sha256:${'b'.repeat(64)}`;
    deepStrictEqual(
      flat(detailsTreeOf({...BOUND, image}, identity).sections)
        .filter(entry => entry.label === 'Image')
        .map(entry => entry.description),
      [image],
    );
  });

  it('F-0901 AC-55: a container created from the tag x:1 is titled x:1 in Details, with the image x:1', () => {
    const tree = detailsTreeOf({...BOUND, labels: {}, image: 'x:1'}, identity);
    deepStrictEqual(
      [
        tree.title,
        flat(tree.sections)
          .filter(entry => entry.label === 'Image')
          .map(entry => entry.description),
      ],
      ['x:1', ['x:1']],
    );
  });

  it('F-0903 AC-14: no entry speaks of mount performance', () => {
    deepStrictEqual(
      flat(detailsTreeOf(BOUND, identity).sections).filter(entry =>
        /performance/i.test(entry.label),
      ),
      [],
    );
  });

  it('F-0903 3.3: viewItem is image on the Image entry, volume on each Volume entry and devContainer on the Configuration entry, and nothing elsewhere', () => {
    const items = flat(detailsTreeOf(BOUND, identity).sections)
      .filter(entry => entry.viewItem !== undefined)
      .map(entry => [entry.label, entry.viewItem]);
    deepStrictEqual(items, [
      ['Image', 'image'],
      ['Configuration', 'devContainer'],
      ['Volume', 'volume'],
    ]);
  });

  it('F-0903 AC-34: volume mounts come first and then bind mounts, each in Docker’s order, and an anonymous volume has a entry', () => {
    const mounts = detailsTreeOf(
      {
        ...BOUND,
        mounts: [
          {type: 'bind', source: '/a', destination: '/x'},
          {type: 'volume', name: 'z'.repeat(64), destination: '/anon'},
          {type: 'bind', source: '/b', destination: '/y'},
          {type: 'volume', name: 'named', destination: '/vscode'},
        ],
      },
      identity,
    ).sections[1];
    deepStrictEqual(
      mounts?.children.map(entry => [
        entry.label,
        entry.children[0]?.description,
      ]),
      [
        ['Volume mount', 'z'.repeat(64)],
        ['Volume mount', 'named'],
        ['Bind mount', '/a'],
        ['Bind mount', '/b'],
      ],
    );
  });

  it('F-0903 BR-13: the ids are the same for the same data and differ for different rows', () => {
    const first = flat(detailsTreeOf(BOUND, identity).sections).map(
      entry => entry.id,
    );
    const second = flat(detailsTreeOf(BOUND, identity).sections).map(
      entry => entry.id,
    );
    deepStrictEqual(
      [first, new Set(first).size === first.length],
      [second, true],
    );
  });

  it('F-0903: every text goes through the translation', () => {
    const labels = flat(
      detailsTreeOf(BOUND, template => `<${template}>`).sections,
    ).map(entry => entry.label);
    deepStrictEqual(
      labels.every(label => label.startsWith('<') && label.endsWith('>')),
      true,
    );
  });
});

describe('the container of docker inspect (card containers-33)', () => {
  it('F-0903 AC-34: a recorded inspect gives the container, its labels, its volumes with the anonymous one and its bind, and no tmpfs', () => {
    const shown = shownContainerOf(RECORDED);
    deepStrictEqual(
      shown === undefined
        ? shown
        : [
            shown.name,
            shown.image,
            shown.labels['devcontainer.local_folder'],
            shown.mounts.map(mount =>
              mount.type === 'volume'
                ? ['volume', mount.destination]
                : ['bind', mount.destination],
            ),
          ],
      [
        '/c33fx',
        'alpine:3.22',
        '/tmp/c33w',
        [
          ['volume', '/anonvol'],
          ['volume', '/vscode'],
          ['bind', '/workspaces/c33w'],
        ],
      ],
    );
  });

  it('F-0903: output that is not one container’s array gives none', () => {
    deepStrictEqual(
      [
        shownContainerOf('not json'),
        shownContainerOf('{}'),
        shownContainerOf('[]'),
        shownContainerOf('[{}, {}]'),
        shownContainerOf('[{"Id": "x", "Name": "/n"}]'),
        shownContainerOf('[null]'),
      ],
      [undefined, undefined, undefined, undefined, undefined, undefined],
    );
  });

  it('F-0903: a container with no labels and no mount list is shown with none, and a mount of another kind or a malformed one is left out', () => {
    const inspected = {
      ['Id']: 'x',
      Name: '/n',
      Config: {Image: 'image', Labels: null},
      Mounts: [
        {Type: 'tmpfs', Destination: '/t'},
        {Type: 'volume', Destination: '/no-name'},
        {Type: 'bind', Source: '/s'},
        'text',
        {Type: 'bind', Source: '/s', Destination: '/ok'},
      ],
    };
    const shown = shownContainerOf(JSON.stringify([inspected]));
    deepStrictEqual(
      [
        shown?.labels,
        shown?.mounts,
        shownContainerOf(
          JSON.stringify([
            {...inspected, Config: {Image: 'image'}, Mounts: undefined},
          ]),
        )?.mounts,
      ],
      [{}, [{type: 'bind', source: '/s', destination: '/ok'}], []],
    );
  });

  it('F-0903: labels whose values are not text are left out', () => {
    deepStrictEqual(
      shownContainerOf(
        JSON.stringify([
          {
            ['Id']: 'x',
            Name: '/n',
            Config: {Image: 'image', Labels: {first: 'text', second: 1}},
          },
        ]),
      )?.labels,
      {first: 'text'},
    );
  });
});
