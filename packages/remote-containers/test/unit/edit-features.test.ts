import {deepStrictEqual} from 'node:assert';
import type {CatalogueFeature} from '../../src/authoring/catalogue.ts';
import {
  catalogueKeyOf,
  editFeatures,
  type FeatureEdit,
  type FeatureEntry,
  type FeaturePicks,
} from '../../src/authoring/edit-features.ts';

/** The catalogue the rows use, and the keys its features are written under. */
const CATALOGUE: CatalogueFeature[] = [
  {
    id: 'ghcr.io/devcontainers/features/common-utils',
    version: '2.5.3',
    name: 'Common Utilities',
    owner: 'devcontainers',
    options: {},
  },
  {
    id: 'ghcr.io/devcontainers/features/go',
    version: '1.22.1',
    name: 'Go',
    owner: 'devcontainers',
    options: {},
  },
  {
    id: 'ghcr.io/devcontainers/features/node',
    version: '20.11.1',
    name: 'Node.js',
    owner: 'devcontainers',
    options: {},
  },
  {
    id: 'ghcr.io/devcontainers/features/npm',
    version: '10.5.0',
    name: 'NPM',
    owner: 'devcontainers',
    options: {},
  },
];

const COMMON = 'ghcr.io/devcontainers/features/common-utils:2';
const goFeature = 'ghcr.io/devcontainers/features/go:1';
const NODE = 'ghcr.io/devcontainers/features/node:20';
const npmFeature = 'ghcr.io/devcontainers/features/npm:10';

/** The file every row starts from, its `"features"` body the rows replace. */
function fileWith(featuresBody: string): string {
  return `{\n  "name": "dev",\n  "image": "mcr.microsoft.com/vscode/devcontainer:1",\n  "features": ${featuresBody}\n}\n`;
}

/** The picks a row gives: the checked keys with optional values, the unchecked keys. */
function picks(
  checked: string[],
  unchecked: string[],
  values?: Record<string, Record<string, unknown>>,
): FeaturePicks {
  const entries: FeatureEntry[] = checked.map(key => ({
    key,
    value: values?.[key] ?? {},
  }));
  return {checked: entries, unchecked};
}

/** One row of the edit table: the file's text, the picks, and the whole output it must give. */
interface Row {
  name: string;
  text: string;
  picks: FeaturePicks;
  expected: FeatureEdit;
}

/** The wizard's options for the node feature, the option names as the feature's schema writes them. */
const nodeOptions = Object.fromEntries([
  ['version', '20'],
  ['npm', '10'],
]);

/** The wizard value of the rich row: arrays, nested objects and null, so the render covers every member form. */
const richValue: Record<string, unknown> = {
  scripts: ['a.sh', {name: 'x', ports: [8080, 8443]}],
  empty: [],
  gone: undefined,
  server: {port: 8080},
};

/** The table: one row per criterion of the card's part A and per boundary, each comparing the whole output text. */
const ROWS: Row[] = [
  {
    name: 'F-0807.AC-14: a checked key not in "features" is added after the existing entries as {}',
    text: fileWith(`{\n    "${COMMON}": {}\n  }`),
    picks: picks([goFeature], []),
    expected: {
      kind: 'edited',
      text: fileWith(`{\n    "${COMMON}": {},\n    "${goFeature}": {}\n  }`),
    },
  },
  {
    name: 'F-0807.AC-14: a checked key with no "features" key creates the object after the other keys',
    text: '{\n  "name": "dev",\n  "image": "mcr.microsoft.com/vscode/devcontainer:1"\n}\n',
    picks: picks([NODE], []),
    expected: {
      kind: 'edited',
      text: `{\n  "name": "dev",\n  "image": "mcr.microsoft.com/vscode/devcontainer:1",\n  "features": {\n    "${NODE}": {}\n  }\n}\n`,
    },
  },
  {
    name: 'F-0807.AC-14: an entry into an empty "features" object lays out one per line',
    text: '{\n  "features": {}\n}\n',
    picks: picks([NODE], []),
    expected: {
      kind: 'edited',
      text: `{\n  "features": {\n    "${NODE}": {}\n  }\n}\n`,
    },
  },
  {
    name: 'F-0807.AC-15: a checked key present with option values becomes {}',
    text: fileWith(`{\n    "${COMMON}": {"username": "devuser"}\n  }`),
    picks: picks([COMMON], []),
    expected: {
      kind: 'edited',
      text: fileWith(`{\n    "${COMMON}": {}\n  }`),
    },
  },
  {
    name: 'F-0807.AC-16: an unchecked key is removed, the other entries keeping their place',
    text: fileWith(`{\n    "${COMMON}": {},\n    "${goFeature}": {}\n  }`),
    picks: picks([], [COMMON]),
    expected: {
      kind: 'edited',
      text: fileWith(`{\n    "${goFeature}": {}\n  }`),
    },
  },
  {
    name: 'F-0807.AC-16: removing the only entry leaves "features": {}',
    text: fileWith(`{\n    "${COMMON}": {}\n  }`),
    picks: picks([], [COMMON]),
    expected: {kind: 'edited', text: fileWith('{}')},
  },
  {
    name: 'F-0807.AC-17: an other-version key keeps its value, the catalogue key added beside it',
    text: fileWith(
      `{\n    "ghcr.io/devcontainers/features/common-utils:3": {"username": "userB"}\n  }`,
    ),
    picks: picks([COMMON], []),
    expected: {
      kind: 'edited',
      text: fileWith(
        `{\n    "ghcr.io/devcontainers/features/common-utils:3": {"username": "userB"},\n    "${COMMON}": {}\n  }`,
      ),
    },
  },
  {
    name: 'F-0807.AC-18: comments, 4-space indentation and every other key are kept, only "features" changes',
    text: `{\n    // the top comment\n    "name": "dev",\n    "image": "mcr.microsoft.com/vscode/devcontainer:1",\n    "features": {\n        // the features comment\n        "${COMMON}": {}\n    },\n    "postAttachCommand": "echo hi"\n}\n`,
    picks: picks([goFeature], []),
    expected: {
      kind: 'edited',
      text: `{\n    // the top comment\n    "name": "dev",\n    "image": "mcr.microsoft.com/vscode/devcontainer:1",\n    "features": {\n        // the features comment\n        "${COMMON}": {},\n        "${goFeature}": {}\n    },\n    "postAttachCommand": "echo hi"\n}\n`,
    },
  },
  {
    name: 'F-0807.AC-27: no "features" key and nothing picked leaves the file byte-identical',
    text: '{\n  "name": "dev",\n  "image": "mcr.microsoft.com/vscode/devcontainer:1"\n}\n',
    picks: picks([], []),
    expected: {kind: 'unchanged'},
  },
  {
    name: "F-0807.AC-31: new keys follow the order the picks give them, the catalogue's among themselves",
    text: fileWith(`{\n    "${NODE}": {}\n  }`),
    picks: picks([COMMON, goFeature], []),
    expected: {
      kind: 'edited',
      text: fileWith(
        `{\n    "${NODE}": {},\n    "${COMMON}": {},\n    "${goFeature}": {}\n  }`,
      ),
    },
  },
  {
    name: 'F-0807.AC-44: existing keys keep their positions, the new keys follow them',
    text: fileWith(`{\n    "${COMMON}": {},\n    "${NODE}": {}\n  }`),
    picks: picks([goFeature, npmFeature], []),
    expected: {
      kind: 'edited',
      text: fileWith(
        `{\n    "${COMMON}": {},\n    "${NODE}": {},\n    "${goFeature}": {},\n    "${npmFeature}": {}\n  }`,
      ),
    },
  },
  {
    name: 'F-0807.AC-45: a local feature, an unindexed reference and a bare legacy id stay in place, the new key follows them',
    text: fileWith(
      `{\n    "./local-feat": {},\n    "ghcr.io/example-org/not-a-real-feature:1": {},\n    "common-utils": {}\n  }`,
    ),
    picks: picks([NODE], []),
    expected: {
      kind: 'edited',
      text: fileWith(
        `{\n    "./local-feat": {},\n    "ghcr.io/example-org/not-a-real-feature:1": {},\n    "common-utils": {},\n    "${NODE}": {}\n  }`,
      ),
    },
  },
  {
    name: 'F-0807.AC-46: unchecking the preselected item keeps the other-version entry unchanged',
    text: fileWith(
      `{\n    "ghcr.io/devcontainers/features/common-utils:3": {"username": "userB"}\n  }`,
    ),
    picks: picks([], [COMMON]),
    expected: {kind: 'unchanged'},
  },
  {
    name: 'F-0807.AC-54: a recoverable syntax error (a missing comma) is kept, the entry written',
    text: `{\n  "features": {\n    "${COMMON}": {}\n "${NODE}": {}\n  }\n}\n`,
    picks: picks([goFeature], []),
    expected: {
      kind: 'edited',
      text: `{\n  "features": {\n    "${COMMON}": {}\n "${NODE}": {},\n    "${goFeature}": {}\n  }\n}\n`,
    },
  },
  {
    name: 'F-0807.AC-55: a "features" value that is an array writes nothing',
    text: '{\n  "features": ["x"]\n}\n',
    picks: picks([NODE], []),
    expected: {kind: 'notAnObject'},
  },
  {
    name: 'F-0807.AC-55: a "features" value that is a string writes nothing',
    text: '{\n  "features": "str"\n}\n',
    picks: picks([NODE], []),
    expected: {kind: 'notAnObject'},
  },
  {
    name: 'F-0807.AC-63: a digest-pinned entry stays with its digest, the catalogue key appended as {}',
    text: fileWith(
      `{\n    "ghcr.io/devcontainers/features/node@sha256:2197ca4e08800a5e07d235f07d235f07d235f07d235f07d235f07d235f": {}\n  }`,
    ),
    picks: picks([NODE], []),
    expected: {
      kind: 'edited',
      text: fileWith(
        `{\n    "ghcr.io/devcontainers/features/node@sha256:2197ca4e08800a5e07d235f07d235f07d235f07d235f07d235f07d235f": {},\n    "${NODE}": {}\n  }`,
      ),
    },
  },
  {
    name: "F-0807.BR-2: a checked key present with {} takes the wizard's object, one option per line in the file's indentation",
    text: fileWith(`{\n    "${NODE}": {}\n  }`),
    picks: picks([NODE], [], {
      [NODE]: nodeOptions,
    }),
    expected: {
      kind: 'edited',
      text: fileWith(
        `{\n    "${NODE}": {\n      "version": "20",\n      "npm": "10"\n    }\n  }`,
      ),
    },
  },
  {
    name: 'F-0807.BR-5: a trailing comment after the last entry ends up after the last appended entry',
    text: fileWith(`{\n    "${COMMON}": {},\n    // the last one\n  }`),
    picks: picks([goFeature], []),
    expected: {
      kind: 'edited',
      text: fileWith(
        `{\n    "${COMMON}": {},\n    "${goFeature}": {},\n    // the last one\n  }`,
      ),
    },
  },
  {
    name: 'F-0807.BR-5: CRLF line ends are kept in the entries the edit writes',
    text: `{\r\n  "features": {\r\n    "${COMMON}": {}\r\n  }\r\n}\r\n`,
    picks: picks([goFeature], []),
    expected: {
      kind: 'edited',
      text: `{\r\n  "features": {\r\n    "${COMMON}": {},\r\n    "${goFeature}": {}\r\n  }\r\n}\r\n`,
    },
  },
  {
    name: 'F-0807.BR-9: rechecking an entry that already holds its value writes nothing',
    text: fileWith(`{\n    "${COMMON}": {}\n  }`),
    picks: picks([COMMON], []),
    expected: {kind: 'unchanged'},
  },
  {
    name: 'containers-150: a root that is not an object writes nothing',
    text: '[1]\n',
    picks: picks([NODE], []),
    expected: {kind: 'notAnObject'},
  },
  {
    name: 'F-0807.AC-14: a checked key into an empty root object adds "features" without a leading comma',
    text: '{}\n',
    picks: picks([COMMON], []),
    expected: {
      kind: 'edited',
      text: `{\n  "features": {\n    "${COMMON}": {}\n  }}\n`,
    },
  },
  {
    name: 'F-0807.AC-14: a file with no indented lines is written with the default two-space indentation',
    text: '{"features":{"x":{}}}\n',
    picks: picks([COMMON], []),
    expected: {
      kind: 'edited',
      text: `{"features":{"x":{},\n    "${COMMON}": {}}}\n`,
    },
  },
  {
    name: 'F-0807.AC-16: removing an entry between two kept ones joins the kept ones with a clean separator',
    text: fileWith(
      `{\n    "${COMMON}": {},\n    "${goFeature}": {},\n    "${NODE}": {}\n  }`,
    ),
    picks: picks([], [goFeature]),
    expected: {
      kind: 'edited',
      text: fileWith(`{\n    "${COMMON}": {},\n    "${NODE}": {}\n  }`),
    },
  },
  {
    name: 'F-0807.BR-2: a wizard value with arrays, a nested object and null renders member by member',
    text: fileWith(`{\n    "${NODE}": {}\n  }`),
    picks: picks([NODE], [], {[NODE]: richValue}),
    expected: {
      kind: 'edited',
      text: fileWith(
        `{\n    "${NODE}": {\n      "scripts": [\n        "a.sh",\n        {\n          "name": "x",\n          "ports": [\n            8080,\n            8443\n          ]\n        }\n      ],\n      "empty": [],\n      "gone": null,\n      "server": {\n        "port": 8080\n      }\n    }\n  }`,
      ),
    },
  },
  {
    name: 'containers-150: a features property with no value and nothing picked writes nothing',
    text: '{\n  "features": {"a"\n}\n}',
    picks: picks([], []),
    expected: {kind: 'unchanged'},
  },
];

/** One row of the id-matching table: a file entry, and the catalogue key it preselects. */
interface KeyRow {
  name: string;
  entryKey: string;
  expected: string | undefined;
}

/** The table: one row per version form of BR-1, and per reference that names nothing. */
const KEY_ROWS: KeyRow[] = [
  {
    name: 'F-0807.BR-1: the catalogue key itself preselects the item',
    entryKey: COMMON,
    expected: COMMON,
  },
  {
    name: 'F-0807.BR-1: a differing patch preselects the item',
    entryKey: 'ghcr.io/devcontainers/features/common-utils:2.5.3',
    expected: COMMON,
  },
  {
    name: 'F-0807.BR-1: an outdated major preselects the item',
    entryKey: 'ghcr.io/devcontainers/features/common-utils:1',
    expected: COMMON,
  },
  {
    name: 'F-0807.BR-1: a nonexistent future major preselects the item',
    entryKey: 'ghcr.io/devcontainers/features/common-utils:9',
    expected: COMMON,
  },
  {
    name: 'F-0807.BR-1: the :latest form preselects the item',
    entryKey: 'ghcr.io/devcontainers/features/common-utils:latest',
    expected: COMMON,
  },
  {
    name: 'F-0807.BR-1: a tagless reference with registry and namespace preselects the item',
    entryKey: 'ghcr.io/devcontainers/features/common-utils',
    expected: COMMON,
  },
  {
    name: 'F-0807.BR-1: a bare legacy id without registry and namespace preselects nothing',
    entryKey: 'common-utils',
    expected: undefined,
  },
  {
    name: 'F-0807.BR-1: the same id under another registry preselects nothing',
    entryKey: 'mcr.microsoft.com/devcontainers/features/common-utils:2',
    expected: undefined,
  },
  {
    name: 'F-0807.BR-1: a digest-pinned reference preselects nothing',
    entryKey:
      'ghcr.io/devcontainers/features/node@sha256:2197ca4e08800a5e07d235f07d235f',
    expected: undefined,
  },
  {
    name: 'F-0807.BR-1: a local feature preselects nothing',
    entryKey: './local-feat',
    expected: undefined,
  },
  {
    name: 'F-0807.BR-1: an unindexed reference preselects nothing',
    entryKey: 'ghcr.io/example-org/not-a-real-feature:1',
    expected: undefined,
  },
];

describe('the edit of a features object (card containers-150, part A)', () => {
  for (const each of ROWS) {
    it(each.name, () => {
      deepStrictEqual(editFeatures(each.text, each.picks), each.expected);
    });
  }
});

describe('the id matching of a file entry (card containers-150, part A)', () => {
  for (const each of KEY_ROWS) {
    it(each.name, () => {
      deepStrictEqual(catalogueKeyOf(each.entryKey, CATALOGUE), each.expected);
    });
  }
});
