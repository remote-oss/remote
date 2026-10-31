import {deepStrictEqual, throws} from 'node:assert';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  descendantRootOf,
  processStatOf,
  processTreeOf,
  treeOf,
} from './process-tree.ts';

/** One line of a `stat` file, with its fields in place. */
function statLine(
  processId: number,
  command: string,
  parent: number,
  group: number,
): string {
  return `${String(processId)} (${command}) S ${String(parent)} ${String(group)} 0 -1 4194304 0`;
}

describe('the process tree read from stat lines', () => {
  /** The run's tree: the machine's root, the run's process, the editor and the editor's window. */
  function standardEntries(): ReadonlyArray<readonly [string, string]> {
    return [
      ['1', statLine(1, 'init', 0, 1)],
      ['100', statLine(100, 'node', 1, 100)],
      ['200', statLine(200, 'code', 100, 200)],
      ['300', statLine(300, 'code renderer', 200, 200)],
      ['400', statLine(400, 'ext host', 300, 300)],
    ];
  }

  /** Writes `entries` to the fixture folder as its stat files. */
  function writeEntries(
    entries: ReadonlyArray<readonly [string, string]>,
  ): void {
    for (const entry of entries) {
      writeFileSync(path.join(folder, entry[0]), entry[1]);
    }
  }

  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'process-tree-'));
  });

  afterEach(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  it('reads the parent and group fields after the command name, which may hold spaces and parentheses', () => {
    deepStrictEqual(
      {
        plain: processStatOf(400, statLine(400, 'ext host', 300, 200)),
        parenthesised: processStatOf(400, statLine(400, 'a (b) c', 300, 200)),
      },
      {
        plain: {processId: 400, parent: 300, group: 200},
        parenthesised: {processId: 400, parent: 300, group: 200},
      },
    );
  });

  it('reads the processes of a folder of stat files named by their process id', () => {
    writeFileSync(path.join(folder, '100'), statLine(100, 'node', 1, 100));
    writeFileSync(path.join(folder, '200'), statLine(200, 'code', 100, 200));
    writeFileSync(path.join(folder, 'notapid'), '');
    const tree = processTreeOf(folder);
    deepStrictEqual(
      {
        size: tree.size,
        hundred: tree.get(100),
        twoHundred: tree.get(200),
        notAPid: tree.get(99),
      },
      {
        size: 2,
        hundred: {processId: 100, parent: 1, group: 100},
        twoHundred: {processId: 200, parent: 100, group: 200},
        notAPid: undefined,
      },
    );
  });

  it('reads a process from a directory that holds its stat file, as /proc lays it out', () => {
    mkdirSync(path.join(folder, '200'));
    writeFileSync(
      path.join(folder, '200', 'stat'),
      statLine(200, 'code', 100, 200),
    );
    deepStrictEqual(processTreeOf(folder).get(200), {
      processId: 200,
      parent: 100,
      group: 200,
    });
  });

  it('leaves out a process whose file vanished between the listing and the read', () => {
    writeFileSync(path.join(folder, '100'), statLine(100, 'node', 1, 100));
    writeFileSync(path.join(folder, '200'), statLine(200, 'code', 100, 200));
    rmSync(path.join(folder, '200'));
    mkdirSync(path.join(folder, '300'));
    deepStrictEqual([...processTreeOf(folder).keys()], [100]);
  });

  it('stops the parent walk at the process the root started', () => {
    writeEntries(standardEntries());
    const tree = processTreeOf(folder);
    deepStrictEqual(
      [descendantRootOf(tree, 400, 100), descendantRootOf(tree, 200, 100)],
      [200, 200],
    );
  });

  it('fails when the start is not in the tree', () => {
    throws(() => descendantRootOf(processTreeOf(folder), 999, 100), {
      message: 'the process 999 is not in the tree',
    });
  });

  it('fails when an ancestor is not in the tree', () => {
    writeFileSync(path.join(folder, '200'), statLine(200, 'code', 100, 200));
    writeFileSync(path.join(folder, '500'), statLine(500, 'other', 1, 500));
    throws(() => descendantRootOf(processTreeOf(folder), 200, 500), {
      message: 'the process 200 is not in the tree',
    });
  });

  it("fails when the chain reaches the machine's root process instead of the root", () => {
    writeFileSync(path.join(folder, '100'), statLine(100, 'node', 0, 100));
    writeFileSync(path.join(folder, '200'), statLine(200, 'code', 100, 200));
    writeFileSync(path.join(folder, '500'), statLine(500, 'other', 1, 500));
    throws(() => descendantRootOf(processTreeOf(folder), 200, 500), {
      message: 'the process 200 never comes under 500',
    });
  });

  it('collects the whole tree of a root, including the root, in id order', () => {
    writeEntries([
      ...standardEntries(),
      ['500', statLine(500, 'unrelated', 1, 500)],
    ]);
    const tree = processTreeOf(folder);
    deepStrictEqual(
      {
        twoHundred: treeOf(tree, 200),
        threeHundred: treeOf(tree, 300),
        fiveHundred: treeOf(tree, 500),
      },
      {
        twoHundred: [200, 300, 400],
        threeHundred: [300, 400],
        fiveHundred: [500],
      },
    );
  });
});
