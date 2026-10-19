import {deepStrictEqual, throws} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const PACKAGE = path.join(import.meta.dirname, '..', '..');

const MANIFEST = JSON.parse(
  readFileSync(path.join(PACKAGE, 'package.json'), 'utf8'),
) as {
  contributes: {menus: Record<string, unknown>};
};

const REOPEN_COMMAND = 'remote-containers.reopenInContainer';

/** The `when` clause the menu `menu` gives the reopen command, or `undefined` when it names no clause. */
function clauseOf(menu: string): string | undefined {
  const entries = (
    MANIFEST.contributes.menus[menu] as Array<Record<string, unknown>>
  ).filter(entry => entry.command === REOPEN_COMMAND);
  if (entries.length !== 1) {
    throw new Error(
      `expected exactly one ${REOPEN_COMMAND} entry in ${menu}, found ${String(entries.length)}`,
    );
  }
  return entries[0]?.when as string | undefined;
}

/**
 * Whether `clause` holds in `context`: the terms are joined by ` && `; a term is `!name` or `name != number`. Any other
 * term throws.
 */
function holds(
  clause: string,
  context: Readonly<Record<string, boolean | number | string>>,
): boolean {
  for (const term of clause.split(' && ')) {
    if (term.startsWith('!')) {
      const value = context[term.slice(1)];
      if (!(
        value === undefined ||
        value === false ||
        value === 0 ||
        value === ''
      )) {
        return false;
      }
      continue;
    }
    const comparison = /^(\S+) != (\S+)$/.exec(term);
    if (comparison !== null) {
      const name = comparison[1] ?? '';
      const number = comparison[2] ?? '';
      if (String(context[name]) === number) {
        return false;
      }
      continue;
    }
    throw new Error(`unsupported term: ${term}`);
  }
  return true;
}

const BASE = {
  hideConnectCommands: false,
  workspaceFolderCount: 1,
  virtualWorkspace: false,
  'remote-containers:standingDown': false,
};

const PALETTE = clauseOf('commandPalette');
const INDICATOR = clauseOf('statusBar/remoteIndicator');

/** Whether the reopen command lists in both menus of `context`. */
function listings(
  context: Readonly<Record<string, boolean | number | string>>,
): [boolean, boolean] {
  return [
    PALETTE !== undefined && holds(PALETTE, context),
    INDICATOR !== undefined && holds(INDICATOR, context),
  ];
}

describe('F-0401 availability of Reopen in Container (card containers-40)', () => {
  it('F-0401 AC-1 (a1): a local window with one folder gets the command in the palette and the indicator', () => {
    deepStrictEqual(listings(BASE), [true, true]);
  });

  it('F-0401 AC-4 (a2): a connected dev container window with its folder does not list the command', () => {
    deepStrictEqual(listings({...BASE, remoteName: 'dev-container'}), [
      false,
      false,
    ]);
  });

  it('F-0401 AC-6 (a3): a dev container window that is not a recovery container does not list the command', () => {
    deepStrictEqual(listings({...BASE, remoteName: 'dev-container'}), [
      false,
      false,
    ]);
  });

  it('F-0401 AC-18 (a4): a dev container window with no folder open does not list the command', () => {
    deepStrictEqual(
      listings({...BASE, workspaceFolderCount: 0, remoteName: 'dev-container'}),
      [false, false],
    );
  });

  it('F-0401 AC-1 (a5): an empty window, a virtual workspace, a standing-down extension and hidden connect commands do not list it', () => {
    const contexts = [
      {...BASE, workspaceFolderCount: 0},
      {...BASE, virtualWorkspace: true},
      {...BASE, 'remote-containers:standingDown': true},
      {...BASE, hideConnectCommands: true},
    ];
    for (const context of contexts) {
      deepStrictEqual(listings(context), [false, false]);
    }
  });

  it('F-0401 AC-1: holds throws on a term it does not know', () => {
    throws(() => holds('a == 1', {}), {
      message: 'unsupported term: a == 1',
    });
  });
});
