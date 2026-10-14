/**
 * @fileoverview The rows of card tooling-31 (#674) for tools/identifier-consumption.ts: the reference rules of §3.2,
 * the registerCommands rule of R2 with its one-level pass-through, the allowlist rows of §3.5, the knip rows of R4,
 * and the repository row against the committed allowlist.
 */

import {deepStrictEqual, throws} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  checkConsumption,
  parseAllowlist,
  type AllowlistEntry,
  type ConsumptionReport,
} from './identifier-consumption.ts';
import {messageOf, REPOSITORY_ROOT} from './repository.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

const BASE_TSCONFIG = {
  compilerOptions: {
    strict: true,
    target: 'es2023',
    module: 'esnext',
    moduleResolution: 'bundler',
    allowImportingTsExtensions: true,
    noEmit: true,
  },
  files: [],
};

/** The stand-in for lib-identifiers, the package the fixture commands lines import registerCommands from. */
const LIB_INDEX = `/** A stand-in for lib-identifiers in the consumption rows. */
export interface CommandEntry {
  readonly id: string;
  readonly title: string;
  readonly palette: boolean;
  readonly policy: 'silent' | 'infoLine';
}
export interface CommandHandler {
  readonly execute: (...commandArguments: unknown[]) => unknown;
}
export interface CommandHost {
  registerCommand(
    commandId: string,
    callback: (...commandArguments: unknown[]) => unknown,
  ): {dispose(): unknown};
}
export type ActivationOutcome = 'standing' | 'serving';
export interface Registration {
  dispose(): unknown;
}
export function registerCommands<
  Commands extends Record<string, CommandEntry>,
>(
  host: CommandHost,
  outcome: ActivationOutcome,
  commands: Commands,
  handlers: {readonly [Name in keyof Commands]: CommandHandler},
): Registration {
  if (outcome === 'standing') {
    throw new Error('registerCommands: an activation that stands down registers nothing');
  }
  void host;
  void commands;
  void handlers;
  return {dispose: () => undefined};
}
export function silentHandlers<Commands extends Record<string, CommandEntry>>(
  commands: Commands,
): {readonly [Name in keyof Commands]: CommandHandler} {
  return {} as {readonly [Name in keyof Commands]: CommandHandler};
}
`;

/** The settings table of the settings rows. */
const SETTINGS_TABLE = `export const settings = {
  logLevel: {id: 'remote-x.logLevel', scope: 'application'},
  path: {id: 'remote-x.path', scope: 'application'},
} as const;
`;

/** The settings table of the contextual row, with a single-literal key. */
const CONTEXTUAL_TABLE = `export const settings = {
  count: {id: 'remote-x.count', scope: 'application'},
  logLevel: {id: 'remote-x.logLevel', scope: 'application'},
  path: {id: 'remote-x.path', scope: 'application'},
} as const;
`;

/** The settings table of the askpass row: the id as the manifest writes it. */
const ASKPASS_TABLE = `export const settings = {
  externalSSHAskpass: {id: 'remote.SSH.externalSSH_ASKPASS', scope: 'application'},
  path: {id: 'remote.SSH.path', scope: 'application'},
} as const;
`;

/** The commands table of the commands rows. */
const COMMANDS_TABLE = `export const commands = {
  alpha: {id: 'remote-x.alpha', title: 'Alpha', palette: true, policy: 'silent'},
  beta: {id: 'remote-x.beta', title: 'Beta', palette: false, policy: 'silent'},
  gamma: {id: 'remote-x.gamma', title: 'Gamma', palette: false, policy: 'silent'},
} as const;
`;

/** The views table of the views row. */
const VIEWS_TABLE = `export const views = {
  remoteTargets: 'remote-x.remoteTargets',
  remoteStatus: 'remote-x.remoteStatus',
} as const;
`;

/** The table of the unchecked-kinds row: a core context key and a called internal command. */
const UNCHECKED_TABLE = `export const contextKeys = {
  standingDown: {id: 'remote-x.standingDown', setter: 'core'},
} as const;

export const internalCommands = {
  queryThing: {id: 'remote-internal.queryThing', role: 'called', kind: 'query'},
} as const;

export const settings = {
  logLevel: {id: 'remote-x.logLevel', scope: 'application'},
} as const;
`;

/** The shared host, outcome and handler factory the commands rows call registerCommands with. */
const SUPPORT = `import {
  type ActivationOutcome,
  type CommandHandler,
  type CommandHost,
} from 'lib-identifiers';

export const host: CommandHost = {
  registerCommand: () => ({dispose: () => undefined}),
};
export const outcome: ActivationOutcome = 'serving';
export function handler(): CommandHandler {
  return {execute: () => undefined};
}
`;

/** The generic activation of the pass-through rows, the shape of remote-explorer's. */
const ACTIVATE_WITH = `import {
  registerCommands,
  silentHandlers,
  type CommandEntry,
  type Registration,
} from 'lib-identifiers';
import {host, outcome} from './support.ts';

export function activateWith<Commands extends Record<string, CommandEntry>>(
  table: {commands: Commands},
): Registration {
  return registerCommands(host, outcome, table.commands, silentHandlers(table.commands));
}
`;

describe('identifier-consumption', () => {
  let workspace: TemporaryWorkspace;

  beforeEach(() => {
    workspace = new TemporaryWorkspace('identifier-consumption');
    workspace.write('tsconfig.base.json', BASE_TSCONFIG);
    workspace.write('packages/lib-identifiers/package.json', {
      name: 'lib-identifiers',
      version: '0.0.0',
      private: true,
      main: './src/index.ts',
    });
    workspace.write('packages/lib-identifiers/src/index.ts', LIB_INDEX);
  });
  afterEach(() => {
    workspace.remove();
  });

  /** A package with its tsconfig, a link to the stub lib-identifiers, a generated table, and src files. */
  function addPackage(
    folder: string,
    generated: string,
    sources: Record<string, string> = {},
  ): void {
    workspace.writeManifest(folder);
    workspace.write(`packages/${folder}/tsconfig.json`, {
      extends: '../../tsconfig.base.json',
      include: ['src'],
    });
    workspace.write(
      `packages/${folder}/src/identifiers.generated.ts`,
      generated,
    );
    for (const [file, content] of Object.entries(sources)) {
      workspace.write(`packages/${folder}/src/${file}`, content);
    }
    workspace.link(
      `packages/${folder}/node_modules/lib-identifiers`,
      'packages/lib-identifiers',
    );
  }

  /** A commands row: the commands table plus the shared support file. */
  function commandsPackage(
    sources: Record<string, string>,
    generated = COMMANDS_TABLE,
  ): void {
    addPackage('remote-x', generated, {
      ...sources,
      'support.ts': SUPPORT,
    });
  }

  /** The knip runner of the tools rows: no unused files. */
  function runKnip(): Promise<string> {
    return Promise.resolve(JSON.stringify({issues: []}));
  }

  /** The knip run whose only issue names the fixture module, which production never imports. */
  function moduleKnip(): Promise<string> {
    return Promise.resolve(
      JSON.stringify({
        issues: [{files: [{name: 'packages/remote-x/src/m.ts'}]}],
      }),
    );
  }

  async function check(
    allowlist: readonly AllowlistEntry[] = [],
    release = false,
    knip = runKnip,
  ): Promise<ConsumptionReport> {
    return checkConsumption(workspace.root, allowlist, {
      release,
      runKnip: knip,
    });
  }

  /** The 1-based line of the first occurrence of `marker` in `source`. */
  function lineOf(source: string, marker: string): number {
    return source.slice(0, source.indexOf(marker)).split('\n').length;
  }

  function entry(
    kind: string,
    key: string,
    card = '#676',
    slice = '0.2 slice 2',
    decision?: string,
  ): AllowlistEntry {
    if (decision === undefined) {
      return {package: 'remote-x', kind, key, card, slice};
    }
    return {package: 'remote-x', kind, key, card, slice, decision};
  }

  describe('the reference rules of §3.2', () => {
    it('reports a settings key no production source reads, and not the one it does (#674 R2)', async () => {
      addPackage('remote-x', SETTINGS_TABLE, {
        'a.ts':
          "import {settings} from './identifiers.generated.ts';\n\nvoid settings.logLevel;\n",
      });
      deepStrictEqual((await check()).problems, [
        'packages/remote-x: settings path (remote-x.path) is contributed but no production source consumes it',
      ]);
    });

    it('consumes a contextually typed key, in a union or a single literal, and not an untyped one (#674 R2)', async () => {
      addPackage('remote-x', CONTEXTUAL_TABLE, {
        'a.ts': `import {settings} from './identifiers.generated.ts';

function valueOf(entry: keyof typeof settings): string {
  return entry;
}
function take(name: string): string {
  return name;
}
function onlyCount(entry: 'count'): string {
  return entry;
}

void valueOf('path');
void onlyCount('count');
void take('logLevel');
const name = 'path';
void name;
`,
      });
      deepStrictEqual((await check()).problems, [
        'packages/remote-x: settings logLevel (remote-x.logLevel) is contributed but no production source consumes it',
      ]);
    });

    it('names an id as written in the table (#674 R2)', async () => {
      addPackage('remote-x', ASKPASS_TABLE, {
        'a.ts':
          "import {settings} from './identifiers.generated.ts';\n\nvoid settings.externalSSHAskpass;\n",
      });
      deepStrictEqual((await check()).problems, [
        'packages/remote-x: settings path (remote.SSH.path) is contributed but no production source consumes it',
      ]);
    });

    it('reports a key referenced only in a test file or under src/testing, both times (#674 R2)', async () => {
      workspace.write(
        'packages/remote-x/test/unit/a.test.ts',
        "import {settings} from '../../src/identifiers.generated.ts';\n\nvoid settings.logLevel;\n",
      );
      addPackage('remote-x', SETTINGS_TABLE, {
        'a.ts': 'export const a = 1;\n',
        'testing/fake.ts':
          "import {settings} from '../identifiers.generated.ts';\n\nexport const fake = settings.path;\n",
      });
      deepStrictEqual((await check()).problems, [
        'packages/remote-x: settings logLevel (remote-x.logLevel) is contributed but no production source consumes it',
        'packages/remote-x: settings path (remote-x.path) is contributed but no production source consumes it',
      ]);
    });

    it('makes a whole-table use a note that consumes no key (#674 R2)', async () => {
      const source =
        "import {settings} from './identifiers.generated.ts';\n\nObject.values(settings).forEach(key => {\n  void key;\n});\n";
      addPackage('remote-x', SETTINGS_TABLE, {'a.ts': source});
      const report = await check();
      deepStrictEqual(
        {problems: report.problems, notes: report.notes},
        {
          problems: [
            'packages/remote-x: settings logLevel (remote-x.logLevel) is contributed but no production source consumes it',
            'packages/remote-x: settings path (remote-x.path) is contributed but no production source consumes it',
          ],
          notes: [
            `whole table: packages/remote-x/src/a.ts:${String(lineOf(source, 'Object.values'))} uses settings`,
          ],
        },
      );
    });

    it('counts a key read through a structurally typed receiver of the table (#674 R2 rule 1)', async () => {
      const source = `import {settings} from './identifiers.generated.ts';

interface SettingEntry {
  readonly id: string;
  readonly scope: string;
}
interface Inputs {
  readonly settings: {readonly logLevel: SettingEntry};
}
function read(table: Inputs): SettingEntry {
  const {settings: theSettings} = table;
  void theSettings;
  return table.settings.logLevel;
}
void read({settings});
`;
      addPackage('remote-x', SETTINGS_TABLE, {'a.ts': source});
      deepStrictEqual(await check(), {
        problems: [
          'packages/remote-x: settings path (remote-x.path) is contributed but no production source consumes it',
        ],
        notes: [
          `whole table: packages/remote-x/src/a.ts:${String(
            lineOf(source, 'void read'),
          )} uses settings`,
        ],
      });
    });

    it('reports a key an unrelated object carries, in an access and a destructuring, and not through an any (#674 R2 rule 1 trap)', async () => {
      addPackage('remote-x', SETTINGS_TABLE, {
        'a.ts': `import {settings} from './identifiers.generated.ts';

const other = {logLevel: 1};
void other.logLevel;
const {logLevel: notTheKey} = other;
void notTheKey;
const anything: any = settings;
void anything.logLevel;
void settings.path;
`,
      });
      deepStrictEqual((await check()).problems, [
        'packages/remote-x: settings logLevel (remote-x.logLevel) is contributed but no production source consumes it',
      ]);
    });

    it('counts the keys a destructuring names, in a rename, a quote and a computed form (#674 R2 rule 1)', async () => {
      addPackage('remote-x', SETTINGS_TABLE, {
        'a.ts': `import {settings} from './identifiers.generated.ts';

const {logLevel} = settings;
const {logLevel: level} = settings;
const {'path': thePath} = settings;
const {['path']: theQuoted} = settings;
const which = 'logLevel';
const {[which]: theWhich} = settings;
let assigned: {id: string; scope: string} = {id: 'none', scope: 'none'};
({logLevel: assigned} = settings);
let path: {id: string; scope: string} = {id: 'none', scope: 'none'};
({path} = settings);
let level2: {id: string; scope: string} = {id: 'none', scope: 'none'};
let rest: {path: {id: string; scope: string}} = {path: {id: 'none', scope: 'none'}};
({logLevel: level2, ...rest} = settings);
void logLevel;
void level;
void thePath;
void theQuoted;
void theWhich;
void assigned;
void path;
void level2;
void rest;
void settings.path;
`,
      });
      deepStrictEqual(await check(), {problems: [], notes: []});
    });
  });

  it('reports nothing the odd entries of a generated file write, and checks the clean ones (#674 R2)', async () => {
    addPackage(
      'remote-x',
      `const first = 'first';
const ghost = 1;
export const settings = {
  logLevel: {id: 'remote-x.logLevel', scope: 'application'},
  [first]: {id: 'remote-x.first', scope: 'application'},
  path: {id: 'remote-x.path', scope: 'application'},
  ghost,
} as const;

export const count = 5;

export declare const declared;

export const views = {
  remoteTargets: 'remote-x.remoteTargets',
  unnamed: {setter: 'extension'},
} as const;

export const [second] = {second: 'remote-x.second'};
`,
      {
        'a.ts':
          "import {settings} from './identifiers.generated.ts';\n\nvoid settings.logLevel;\n",
      },
    );
    deepStrictEqual((await check()).problems, [
      'packages/remote-x: settings path (remote-x.path) is contributed but no production source consumes it',
      'packages/remote-x: views remoteTargets (remote-x.remoteTargets) is contributed but no production source consumes it',
    ]);
  });

  it('reads a template-literal id as the table writes it (#674 R2)', async () => {
    addPackage(
      'remote-x',
      'export const settings = {\n' +
        "  logLevel: {id: `remote-x.logLevel`, scope: 'application'},\n" +
        "  path: {id: 'remote-x.path', scope: 'application'},\n" +
        '  } as const;\n',
      {
        'a.ts':
          "import {settings} from './identifiers.generated.ts';\n\nvoid settings.logLevel;\n",
      },
    );
    deepStrictEqual((await check()).problems, [
      'packages/remote-x: settings path (remote-x.path) is contributed but no production source consumes it',
    ]);
  });

  it('reports nothing for a package whose program has no table file (#674)', async () => {
    addPackage('remote-x', SETTINGS_TABLE, {
      'a.ts': 'export const a = 1;\n',
    });
    workspace.write('packages/remote-x/tsconfig.json', {
      extends: '../../tsconfig.base.json',
      files: ['src/a.ts'],
    });
    deepStrictEqual(await check(), {problems: [], notes: []});
  });

  it('consumes no key referenced only in a test file inside src or in a JavaScript file (#674 R2)', async () => {
    addPackage('remote-x', SETTINGS_TABLE, {
      'a.ts': 'export const a = 1;\n',
      'x.test.ts':
        "import {settings} from './identifiers.generated.ts';\n\nvoid settings.logLevel;\n",
      'y.js':
        "import {settings} from './identifiers.generated.ts';\n\nvoid settings.path;\n",
    });
    workspace.write('packages/remote-x/tsconfig.json', {
      extends: '../../tsconfig.base.json',
      include: ['src'],
      compilerOptions: {allowJs: true},
    });
    deepStrictEqual((await check()).problems, [
      'packages/remote-x: settings logLevel (remote-x.logLevel) is contributed but no production source consumes it',
      'packages/remote-x: settings path (remote-x.path) is contributed but no production source consumes it',
    ]);
  });

  it('does not count a property name in a type, even with a table key (#674 R2)', async () => {
    addPackage('remote-x', SETTINGS_TABLE, {
      'a.ts': `interface Filter {
  'logLevel': string;
}
`,
    });
    deepStrictEqual((await check()).problems, [
      'packages/remote-x: settings logLevel (remote-x.logLevel) is contributed but no production source consumes it',
      'packages/remote-x: settings path (remote-x.path) is contributed but no production source consumes it',
    ]);
  });

  it('consumes the names of an object contextually typed by the table itself (#674 R2)', async () => {
    addPackage('remote-x', SETTINGS_TABLE, {
      'a.ts': `import {settings} from './identifiers.generated.ts';

function dumpOf(pick: typeof settings): string {
  return '';
}
function pickOf(pick: Pick<typeof settings, 'logLevel'> & {other: string}): void {
  void pick;
}
const rest = {logLevel: 'low'};
void dumpOf({logLevel: 'low', path: '/tmp'});
void dumpOf({...rest, path: '/tmp'});
void dumpOf({'logLevel': 'low', 'path': '/tmp'});
void dumpOf({['logLevel']: 'low', path: '/tmp', 9: 'x'});
void dumpOf({logLevel: 'low', path: '/tmp', extra: 'x'});
void pickOf({logLevel: 'low', other: 'x'});
`,
    });
    deepStrictEqual(await check(), {problems: [], notes: []});
  });

  it('reads a key through an import alias, and not through the aliased name (#674 R2)', async () => {
    addPackage('remote-x', SETTINGS_TABLE, {
      'a.ts': `import {settings as theSettings} from './identifiers.generated.ts';

void theSettings.logLevel;
`,
    });
    deepStrictEqual((await check()).problems, [
      'packages/remote-x: settings path (remote-x.path) is contributed but no production source consumes it',
    ]);
  });

  it('resolves a pass-through through a cyclic table type, where the cycle carries no table (#674 R2)', async () => {
    const source = `import {commands} from './identifiers.generated.ts';
import {
  registerCommands,
  silentHandlers,
  type CommandEntry,
} from 'lib-identifiers';
import {host, outcome} from './support.ts';

interface Tree<T> {
  self: Tree<T>;
  commands: T;
}
function treeActivate<T extends Record<string, CommandEntry>>(node: Tree<T>): void {
  registerCommands(host, outcome, node.commands, silentHandlers(node.commands));
}
const root: Tree<typeof commands> = {self: root, commands: commands};
void treeActivate(root);
`;
    commandsPackage({'tree.ts': source});
    deepStrictEqual(await check(), {
      problems: [],
      notes: [
        `whole table: packages/remote-x/src/tree.ts:${String(
          lineOf(source, 'commands: commands'),
        )} uses commands`,
      ],
    });
  });

  it('resolves a pass-through past a parameter that carries no table (#674 R2)', async () => {
    commandsPackage({
      'sibling.ts': `import {commands} from './identifiers.generated.ts';
import {
  registerCommands,
  silentHandlers,
  type CommandEntry,
  type Registration,
} from 'lib-identifiers';
import {host, outcome} from './support.ts';

export function withSibling<Commands extends Record<string, CommandEntry>>(
  decoy: {unrelated: string},
  table: {commands: Commands},
): Registration {
  return registerCommands(host, outcome, table.commands, silentHandlers(table.commands));
}
void withSibling({unrelated: 'x'}, {commands});
`,
    });
    deepStrictEqual(await check(), {problems: [], notes: []});
  });

  it('reads a key through a re-export, alias and all (#674 R2)', async () => {
    addPackage('remote-x', SETTINGS_TABLE, {
      'a.ts': `export {settings as tableSettings} from './identifiers.generated.ts';
`,
      'b.ts':
        "import {settings} from './identifiers.generated.ts';\n\nvoid settings.logLevel;\n",
    });
    deepStrictEqual((await check()).problems, [
      'packages/remote-x: settings path (remote-x.path) is contributed but no production source consumes it',
    ]);
  });

  describe('the registerCommands rule of R2', () => {
    it('consumes the keys a call carries, by key, in a subset literal (#674 R2)', async () => {
      commandsPackage({
        'a.ts': `import {commands} from './identifiers.generated.ts';
import {registerCommands} from 'lib-identifiers';
import {handler, host, outcome} from './support.ts';

registerCommands(host, outcome, {alpha: commands.alpha, beta: commands.beta}, {alpha: handler(), beta: handler()});
`,
      });
      deepStrictEqual((await check()).problems, [
        'packages/remote-x: commands gamma (remote-x.gamma) is contributed but no production source consumes it',
      ]);
    });

    it('consumes a table passed whole, with no note (#674 R2)', async () => {
      commandsPackage({
        'a.ts': `import {commands} from './identifiers.generated.ts';
import {registerCommands} from 'lib-identifiers';
import {handler, host, outcome} from './support.ts';

registerCommands(host, outcome, commands, {alpha: handler(), beta: handler(), gamma: handler()});
`,
      });
      deepStrictEqual(await check(), {problems: [], notes: []});
    });

    it('consumes through a variable and a spread (#674 R2)', async () => {
      commandsPackage({
        'a.ts': `import {commands} from './identifiers.generated.ts';
import {registerCommands} from 'lib-identifiers';
import {handler, host, outcome} from './support.ts';

const served = {alpha: commands.alpha};
registerCommands(host, outcome, {...served, beta: commands.beta}, {alpha: handler(), beta: handler()});
`,
      });
      deepStrictEqual((await check()).problems, [
        'packages/remote-x: commands gamma (remote-x.gamma) is contributed but no production source consumes it',
      ]);
    });

    it('reads a member-built map of widened CommandEntry by key, not by id (#674 R2, triton site 1)', async () => {
      commandsPackage({
        'a.ts': `import {commands} from './identifiers.generated.ts';
import {registerCommands, type CommandEntry} from 'lib-identifiers';
import {handler, host, outcome} from './support.ts';

const served = {alpha: commands.alpha as CommandEntry};
registerCommands(host, outcome, served, {alpha: handler()});
`,
      });
      deepStrictEqual((await check()).problems, [
        'packages/remote-x: commands beta (remote-x.beta) is contributed but no production source consumes it',
        'packages/remote-x: commands gamma (remote-x.gamma) is contributed but no production source consumes it',
      ]);
    });

    it('resolves a type parameter at its production call site (#674 R2, triton site 2)', async () => {
      commandsPackage({
        'activation.ts': ACTIVATE_WITH,
        'extension.ts': `import {commands} from './identifiers.generated.ts';
import {activateWith} from './activation.ts';

void activateWith({commands});
`,
      });
      deepStrictEqual(await check(), {problems: [], notes: []});
    });

    it('reports a type parameter whose only call site is in a test file (#674 R2)', async () => {
      const activation = ACTIVATE_WITH;
      commandsPackage({'activation.ts': activation});
      workspace.write(
        'packages/remote-x/test/unit/a.test.ts',
        `import {activateWith} from '../../src/activation.ts';
import {commands} from '../../src/identifiers.generated.ts';

void activateWith({commands});
`,
      );
      deepStrictEqual((await check()).problems, [
        'packages/remote-x: commands alpha (remote-x.alpha) is contributed but no production source consumes it',
        'packages/remote-x: commands beta (remote-x.beta) is contributed but no production source consumes it',
        'packages/remote-x: commands gamma (remote-x.gamma) is contributed but no production source consumes it',
        `packages/remote-x: src/activation.ts:${String(lineOf(activation, 'registerCommands('))}: the commands of this registerCommands call can't be seen (type parameter Commands)`,
      ]);
    });

    it('does not look through a second type parameter, one level only (#674 R2)', async () => {
      const activation = ACTIVATE_WITH;
      commandsPackage({
        'activation.ts': activation,
        'outer.ts': `import {type CommandEntry} from 'lib-identifiers';
import {activateWith} from './activation.ts';

export function wrapper<T extends Record<string, CommandEntry>>(table: {commands: T}) {
  return activateWith(table);
}
`,
      });
      deepStrictEqual((await check()).problems, [
        'packages/remote-x: commands alpha (remote-x.alpha) is contributed but no production source consumes it',
        'packages/remote-x: commands beta (remote-x.beta) is contributed but no production source consumes it',
        'packages/remote-x: commands gamma (remote-x.gamma) is contributed but no production source consumes it',
        `packages/remote-x: src/activation.ts:${String(lineOf(activation, 'registerCommands('))}: the commands of this registerCommands call can't be seen (type parameter Commands)`,
      ]);
    });

    it('reports every command of a table no registerCommands call carries (#674 R2)', async () => {
      commandsPackage({
        'a.ts':
          "import {commands} from './identifiers.generated.ts';\n\nvoid commands.alpha;\n",
      });
      deepStrictEqual((await check()).problems, [
        'packages/remote-x: commands alpha (remote-x.alpha) is contributed but no production source consumes it',
        'packages/remote-x: commands beta (remote-x.beta) is contributed but no production source consumes it',
        'packages/remote-x: commands gamma (remote-x.gamma) is contributed but no production source consumes it',
      ]);
    });

    it('carries the union of the keys of a union of maps', async () => {
      commandsPackage({
        'a.ts': `import {commands} from './identifiers.generated.ts';
import {registerCommands} from 'lib-identifiers';
import {handler, host, outcome} from './support.ts';

registerCommands(host, outcome, outcome === 'serving' ? {alpha: commands.alpha} : {beta: commands.beta}, {alpha: handler(), beta: handler()});
`,
      });
      deepStrictEqual((await check()).problems, [
        'packages/remote-x: commands gamma (remote-x.gamma) is contributed but no production source consumes it',
      ]);
    });

    it('lets an any-typed third argument carry no keys and name no problem', async () => {
      commandsPackage({
        'a.ts': `import {commands} from './identifiers.generated.ts';
import {registerCommands} from 'lib-identifiers';
import {handler, host, outcome} from './support.ts';

const anyCommands: any = commands;
registerCommands(host, outcome, anyCommands, {alpha: handler(), beta: handler(), gamma: handler()});
`,
      });
      deepStrictEqual((await check()).problems, [
        'packages/remote-x: commands alpha (remote-x.alpha) is contributed but no production source consumes it',
        'packages/remote-x: commands beta (remote-x.beta) is contributed but no production source consumes it',
        'packages/remote-x: commands gamma (remote-x.gamma) is contributed but no production source consumes it',
      ]);
    });

    it('names a call missing its argument as unresolvable', async () => {
      const activation = ACTIVATE_WITH;
      commandsPackage({
        'activation.ts': activation,
        'broken.ts': `import {activateWith} from './activation.ts';

void activateWith();
`,
      });
      deepStrictEqual((await check()).problems, [
        'packages/remote-x: commands alpha (remote-x.alpha) is contributed but no production source consumes it',
        'packages/remote-x: commands beta (remote-x.beta) is contributed but no production source consumes it',
        'packages/remote-x: commands gamma (remote-x.gamma) is contributed but no production source consumes it',
        `packages/remote-x: src/activation.ts:${String(lineOf(activation, 'registerCommands('))}: the commands of this registerCommands call can't be seen (type parameter Commands)`,
      ]);
    });

    it('names a call whose argument lacks a property of the path as unresolvable', async () => {
      const activation = ACTIVATE_WITH;
      commandsPackage({
        'activation.ts': activation,
        'broken.ts': `import {commands} from './identifiers.generated.ts';
import {activateWith} from './activation.ts';

void activateWith({commands} as unknown as {table: {}});
`,
      });
      deepStrictEqual((await check()).problems, [
        'packages/remote-x: commands alpha (remote-x.alpha) is contributed but no production source consumes it',
        'packages/remote-x: commands beta (remote-x.beta) is contributed but no production source consumes it',
        'packages/remote-x: commands gamma (remote-x.gamma) is contributed but no production source consumes it',
        `packages/remote-x: src/activation.ts:${String(lineOf(activation, 'registerCommands('))}: the commands of this registerCommands call can't be seen (type parameter Commands)`,
      ]);
    });

    it('names a type parameter no enclosing function carries in a parameter as unresolvable', async () => {
      const source = `import {registerCommands, silentHandlers, type CommandEntry} from 'lib-identifiers';
import {host, outcome} from './support.ts';

export function outer<T extends Record<string, CommandEntry>>({commands}: {commands: T}): void {
  function inner(): void {
    registerCommands(host, outcome, commands, silentHandlers(commands));
  }
  inner();
}
`;
      commandsPackage({'outer.ts': source});
      deepStrictEqual((await check()).problems, [
        'packages/remote-x: commands alpha (remote-x.alpha) is contributed but no production source consumes it',
        'packages/remote-x: commands beta (remote-x.beta) is contributed but no production source consumes it',
        'packages/remote-x: commands gamma (remote-x.gamma) is contributed but no production source consumes it',
        `packages/remote-x: src/outer.ts:${String(lineOf(source, 'registerCommands('))}: the commands of this registerCommands call can't be seen (type parameter T)`,
      ]);
    });
  });

  describe('the other kinds', () => {
    it('consumes a view inside a registration call, and reports the one a const never reaches (#674 R2)', async () => {
      addPackage('remote-x', VIEWS_TABLE, {
        'a.ts': `import {views} from './identifiers.generated.ts';

const editor = {
  window: {
    createTreeView: (name: string, provider: unknown) => ({dispose: () => undefined}),
  },
};
editor.window.createTreeView(views.remoteTargets, undefined);
const status = views.remoteStatus;
void status;
`,
      });
      deepStrictEqual((await check()).problems, [
        'packages/remote-x: views remoteStatus (remote-x.remoteStatus) is contributed but no production source consumes it',
      ]);
    });

    it('counts a views key a function forwards to a registration, and reports the one no production call forwards (#674 R2)', async () => {
      addPackage('remote-x', VIEWS_TABLE, {
        'a.ts': `import {views} from './identifiers.generated.ts';

const editor = {
  window: {
    createTreeView: (name: string, provider: unknown) => ({dispose: () => undefined}),
  },
};
function show(viewId: string): {dispose: () => undefined} {
  return editor.window.createTreeView(viewId, undefined);
}
void show(views.remoteTargets);
const {remoteStatus: theStatus} = views;
void theStatus;
export function showStatus(statusId: string): {dispose: () => undefined} {
  return editor.window.createTreeView(statusId, undefined);
}
`,
      });
      workspace.write(
        'packages/remote-x/test/unit/a.test.ts',
        `import {showStatus} from '../../src/a.ts';
import {views} from '../../src/identifiers.generated.ts';

void showStatus(views.remoteStatus);
`,
      );
      deepStrictEqual((await check()).problems, [
        'packages/remote-x: views remoteStatus (remote-x.remoteStatus) is contributed but no production source consumes it',
      ]);
    });

    it('counts a served internal command by the id a const carries, and not the one widened to a string (#674 R2)', async () => {
      const SERVED_TABLE = `export const internalCommands = {
  alpha: {id: 'remote-internal.alpha', role: 'served', kind: 'query'},
} as const;
`;
      addPackage('remote-x', SERVED_TABLE, {
        'a.ts': `const ENDPOINTS = {alpha: {commandId: 'remote-internal.alpha'}} as const;
const protocol = {serve: (descriptor: {commandId: string}) => undefined};
void protocol.serve({commandId: ENDPOINTS.alpha.commandId});
`,
      });
      addPackage('remote-y', SERVED_TABLE, {
        'a.ts': `const name = 'alpha';
const protocol = {serve: (descriptor: {commandId: string}) => undefined};
void protocol.serve({commandId: 'remote-internal.' + name});
`,
      });
      deepStrictEqual((await check()).problems, [
        'packages/remote-y: internalCommands alpha (remote-internal.alpha) is contributed but no production source consumes it',
      ]);
    });

    it('counts a context key its stand-down key sets, and not the one a different stand-down key names (#674 R2)', async () => {
      function standDownTable(contextKey: string): string {
        return `export const contextKeys = {
  standingDown: {id: 'x.standingDown', setter: 'extension'},
} as const;

export const standDown = {
  standsDownFor: 'x.standsDownFor',
  contextKey: '${contextKey}',
} as const;
`;
      }
      const STAND_DOWN_SOURCE = `import {standDown} from './identifiers.generated.ts';

void standDown.contextKey;
`;
      addPackage('remote-x', standDownTable('x.standingDown'), {
        'a.ts': STAND_DOWN_SOURCE,
      });
      addPackage('remote-y', standDownTable('x.other'), {
        'a.ts': STAND_DOWN_SOURCE,
      });
      deepStrictEqual((await check()).problems, [
        'packages/remote-y: contextKeys standingDown (x.standingDown) is contributed but no production source consumes it',
      ]);
    });

    it('leaves out a core context key and a called internal command (#674 R2)', async () => {
      addPackage('remote-x', UNCHECKED_TABLE, {
        'a.ts':
          "import {settings} from './identifiers.generated.ts';\n\nvoid settings.logLevel;\n",
      });
      deepStrictEqual((await check()).problems, []);
    });
  });

  it('reports every command when the call names no commands argument (#674 R2)', async () => {
    commandsPackage({
      'a.ts': `import {registerCommands} from 'lib-identifiers';
import {host, outcome} from './support.ts';

void registerCommands(host, outcome);
`,
    });
    deepStrictEqual((await check()).problems, [
      'packages/remote-x: commands alpha (remote-x.alpha) is contributed but no production source consumes it',
      'packages/remote-x: commands beta (remote-x.beta) is contributed but no production source consumes it',
      'packages/remote-x: commands gamma (remote-x.gamma) is contributed but no production source consumes it',
    ]);
  });

  it('names a type parameter whose call arguments carry the table only in the type (#674 R2)', async () => {
    const activation = ACTIVATE_WITH;
    const broken = `import {commands} from './identifiers.generated.ts';
import {activateWith} from './activation.ts';

const served = {commands};
void activateWith(served);
void activateWith({other: 'x'});
const wrapped = {otherProp: served};
void activateWith(wrapped.otherProp);
`;
    commandsPackage({'activation.ts': activation, 'broken.ts': broken});
    deepStrictEqual(await check(), {
      problems: [
        'packages/remote-x: commands alpha (remote-x.alpha) is contributed but no production source consumes it',
        'packages/remote-x: commands beta (remote-x.beta) is contributed but no production source consumes it',
        'packages/remote-x: commands gamma (remote-x.gamma) is contributed but no production source consumes it',
        `packages/remote-x: src/activation.ts:${String(
          lineOf(activation, 'registerCommands('),
        )}: the commands of this registerCommands call can't be seen (type parameter Commands)`,
      ],
      notes: [
        `whole table: packages/remote-x/src/broken.ts:${String(
          lineOf(broken, 'const served'),
        )} uses commands`,
      ],
    });
  });

  it('names the whole-table use a pass-through argument that hides the table (#674 R2)', async () => {
    const activation = ACTIVATE_WITH;
    const source = `import {commands} from './identifiers.generated.ts';
import {activateWith} from './activation.ts';

const parts = {commands};
void activateWith({...parts});
`;
    commandsPackage({'activation.ts': activation, 'a.ts': source});
    deepStrictEqual(await check(), {
      problems: [],
      notes: [
        `whole table: packages/remote-x/src/a.ts:${String(
          lineOf(source, 'const parts'),
        )} uses commands`,
      ],
    });
  });

  it('counts a pass-through argument at two property levels of one argument, and names the one it cannot reach (#674 R2)', async () => {
    const source = `import {commands} from './identifiers.generated.ts';
import {
  registerCommands,
  silentHandlers,
  type CommandEntry,
  type Registration,
} from 'lib-identifiers';
import {host, outcome} from './support.ts';

export function deepActivate<Commands extends Record<string, CommandEntry>>(
  arg: {outer: {commands: Commands}},
): Registration {
  return registerCommands(host, outcome, arg.outer.commands, silentHandlers(arg.outer.commands));
}
const served = {commands};
const nested = {commands: served};
const wrapped = {otherProp: served};
void deepActivate({outer: nested.commands});
void deepActivate({outer: wrapped.otherProp});
`;
    commandsPackage({'deep.ts': source});
    deepStrictEqual(await check(), {
      problems: [],
      notes: [
        `whole table: packages/remote-x/src/deep.ts:${String(
          lineOf(source, 'const served'),
        )} uses commands`,
      ],
    });
  });

  describe('the allowlist of §3.5', () => {
    it('does not report an allowlisted key that stays unconsumed (#674 R3)', async () => {
      addPackage('remote-x', SETTINGS_TABLE, {
        'a.ts':
          "import {settings} from './identifiers.generated.ts';\n\nvoid settings.logLevel;\n",
      });
      deepStrictEqual((await check([entry('settings', 'path')])).problems, []);
    });

    it('reports an allowlisted key that is consumed now, with its card (#674 R3)', async () => {
      addPackage('remote-x', SETTINGS_TABLE, {
        'a.ts':
          "import {settings} from './identifiers.generated.ts';\n\nvoid settings.logLevel;\nvoid settings.path;\n",
      });
      deepStrictEqual((await check([entry('settings', 'path')])).problems, [
        'allowlist: remote-x settings path is consumed now; remove it (card #676)',
      ]);
    });

    it('reports an allowlisted key that names nothing (#674 R3)', async () => {
      addPackage('remote-x', SETTINGS_TABLE, {
        'a.ts':
          "import {settings} from './identifiers.generated.ts';\n\nvoid settings.logLevel;\nvoid settings.path;\n",
      });
      deepStrictEqual((await check([entry('settings', 'nope')])).problems, [
        'allowlist: remote-x settings nope names nothing',
      ]);
    });

    it('names an allowlisted module that names no file (#674 R3)', async () => {
      addPackage('remote-x', SETTINGS_TABLE, {
        'a.ts':
          "import {settings} from './identifiers.generated.ts';\n\nvoid settings.logLevel;\nvoid settings.path;\n",
      });
      deepStrictEqual(
        (await check([entry('module', 'src/gone.ts')])).problems,
        ['allowlist: remote-x module src/gone.ts names nothing'],
      );
    });

    it('names an allowlisted module that production imports now (#674 R3)', async () => {
      workspace.write('packages/remote-x/src/m.ts', 'export const m = 1;\n');
      addPackage('remote-x', SETTINGS_TABLE, {
        'a.ts':
          "import {m} from './m.ts';\nimport {settings} from './identifiers.generated.ts';\n\nvoid m;\nvoid settings.logLevel;\nvoid settings.path;\n",
      });
      deepStrictEqual((await check([entry('module', 'src/m.ts')])).problems, [
        'allowlist: remote-x module src/m.ts is consumed now; remove it (card #676)',
      ]);
    });

    it('names the unknown field of an allowlist entry on parse', () => {
      throws(
        () =>
          parseAllowlist(
            JSON.stringify({
              entries: [
                {
                  package: 'remote-x',
                  kind: 'settings',
                  key: 'path',
                  card: '#676',
                  slice: '0.2',
                  extra: 1,
                },
              ],
            }),
          ),
        {message: /unknown field 'extra'/},
      );
    });

    it('parses an entry with and without a recorded decision', () => {
      const entries = [
        {
          package: 'remote-x',
          kind: 'settings',
          key: 'path',
          card: '#676',
          slice: '0.2',
        },
        {
          package: 'remote-x',
          kind: 'module',
          key: 'src/m.ts',
          card: '#676',
          slice: '0.2',
          decision: 'D-1',
        },
      ];
      deepStrictEqual(parseAllowlist(JSON.stringify({entries})), entries);
    });

    it('names what is wrong with the allowlist on parse', () => {
      function entryJson(fields: Record<string, unknown>): string {
        return JSON.stringify({entries: [fields]});
      }
      const cases: Array<[string, string | RegExp]> = [
        ['hello', /Unexpected token/],
        ['5', 'unconsumed-allowlist.json: the top level must be an object'],
        ['null', 'unconsumed-allowlist.json: the top level must be an object'],
        ['[]', 'unconsumed-allowlist.json: the top level must be an object'],
        [
          '{"entries": 5}',
          'unconsumed-allowlist.json: "entries" must be an array',
        ],
        [
          '{"entries": ["x"]}',
          'unconsumed-allowlist.json: entries[0] must be an object',
        ],
        [
          '{"entries": [null]}',
          'unconsumed-allowlist.json: entries[0] must be an object',
        ],
        [
          '{"entries": [[]]}',
          'unconsumed-allowlist.json: entries[0] must be an object',
        ],
        [
          entryJson({
            package: 'remote-x',
            kind: 'settings',
            key: 'path',
            card: 5,
            slice: '0.2',
          }),
          'unconsumed-allowlist.json: entries[0].card must be a string',
        ],
        [
          entryJson({
            package: 'remote-x',
            kind: 'settings',
            key: 'path',
            slice: '0.2',
          }),
          'unconsumed-allowlist.json: entries[0].card must be a string',
        ],
        [
          entryJson({
            package: 'remote-x',
            kind: 'settings',
            key: 'path',
            card: '#676',
            slice: '0.2',
            decision: 5,
          }),
          'unconsumed-allowlist.json: entries[0].decision must be a string',
        ],
      ];
      deepStrictEqual(
        cases.map(([text, expected]) => {
          try {
            parseAllowlist(text);
            return 'no error';
          } catch (error) {
            const message = messageOf(error);
            const matches =
              expected instanceof RegExp
                ? expected.test(message)
                : message === expected;
            return matches ? expected : message;
          }
        }),
        cases.map(([, expected]) => expected),
      );
    });

    it('names only the entries without a recorded decision on the tag run (#674 R3)', async () => {
      addPackage('remote-x', SETTINGS_TABLE, {'a.ts': 'export const a = 1;\n'});
      deepStrictEqual(
        (
          await check(
            [
              entry('settings', 'logLevel'),
              entry('settings', 'path', '#674', 'deferred', 'D-1'),
            ],
            true,
          )
        ).problems,
        [
          'allowlist: remote-x settings logLevel must be wired before a release (card #676, 0.2 slice 2)',
        ],
      );
    });
  });

  describe('the knip rows of R4', () => {
    it('reports a production-only module from the knip run', async () => {
      workspace.write('packages/remote-x/src/m.ts', 'export const m = 1;\n');
      deepStrictEqual((await check([], false, moduleKnip)).problems, [
        'packages/remote-x: module src/m.ts is imported only by tests',
      ]);
    });

    it('drops the unused files under src/testing, and reports the rest of the knip run (#674 R4)', async () => {
      function knip(): Promise<string> {
        return Promise.resolve(
          JSON.stringify({
            issues: [
              {
                files: [
                  {name: 'packages/remote-x/src/m.ts'},
                  {name: 'packages/remote-x/src/testing/fake.ts'},
                ],
              },
            ],
          }),
        );
      }
      deepStrictEqual((await check([], false, knip)).problems, [
        'packages/remote-x: module src/m.ts is imported only by tests',
      ]);
    });

    it('does not report an allowlisted production-only module', async () => {
      workspace.write('packages/remote-x/src/m.ts', 'export const m = 1;\n');
      deepStrictEqual(
        (await check([entry('module', 'src/m.ts')], false, moduleKnip))
          .problems,
        [],
      );
    });

    it('fails the check when the knip output is not the expected JSON', async () => {
      function knip(): Promise<string> {
        return Promise.resolve('not json');
      }
      deepStrictEqual((await check([], false, knip)).problems, [
        'knip output not understood',
      ]);
    });

    it('understands the knip JSON shapes, and names the ones it does not (#674 R4)', async () => {
      workspace.write('packages/remote-x/src/m.ts', 'export const m = 1;\n');
      const notUnderstood = [
        'null',
        '5',
        '[]',
        '{}',
        '{"issues": 5}',
        '{"issues": ["x"]}',
        '{"issues": [null]}',
        '{"issues": [[1]]}',
        '{"issues": [{"files": "x"}]}',
        '{"issues": [{"files": [1]}]}',
        '{"issues": [{"files": [{"name": 1}]}]}',
      ];
      const answers = await Promise.all([
        ...notUnderstood.map(output =>
          check([entry('module', 'src/m.ts')], false, () =>
            Promise.resolve(output),
          ),
        ),
        check([], false, () => Promise.resolve('{"issues": [{"name": "x"}]}')),
        check([], false, () =>
          Promise.resolve(
            '{"issues": [{"files": [{"name": "packages/lib-log/tools/a.ts"}]}]}',
          ),
        ),
      ]);
      deepStrictEqual(
        answers.map(report => report.problems),
        [...notUnderstood.map(() => ['knip output not understood']), [], []],
      );
    });
  });

  describe('the repository', () => {
    it('reports a package whose program cannot be built as fatal', async () => {
      workspace.write(
        'packages/remote-x/src/identifiers.generated.ts',
        SETTINGS_TABLE,
      );
      workspace.writeManifest('remote-x');
      deepStrictEqual(await check(), {
        problems: [],
        notes: [],
        fatal:
          'packages/remote-x: the program cannot be built: tsconfig.json is missing',
      });
    });

    it('covers the repository with the committed allowlist and the real knip (#674)', async function () {
      // The real knip run dominates; the CI runner is several times slower than local.
      this.timeout(600_000);
      const allowlist = parseAllowlist(
        readFileSync(
          path.join(REPOSITORY_ROOT, 'tools', 'unconsumed-allowlist.json'),
          'utf8',
        ),
      );
      const report = await checkConsumption(REPOSITORY_ROOT, allowlist, {
        release: false,
        runKnip: undefined,
      });
      // The committed allowlist covers main as it is: the check runs to completion and names no problem. Notes carry
      // line numbers that move with main, so the row asserts the problems only.
      deepStrictEqual([report.fatal, report.problems], [undefined, []]);
    });
  });
});
