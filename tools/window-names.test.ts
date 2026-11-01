import {deepStrictEqual, strictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  claimWindowName,
  folderWindowName,
  processRuns,
  recordedWindowNames,
  recordWindowName,
  windowNameOf,
} from '../tests/acceptance/window-agent/src/window-name.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

describe('window-names', () => {
  let workspace: TemporaryWorkspace;
  let claims: string;
  let pids: string;

  beforeEach(() => {
    workspace = new TemporaryWorkspace('window-names');
    claims = path.join(workspace.root, 'agent', 'claims');
    pids = path.join(workspace.root, 'agent', 'pids');
  });

  afterEach(() => {
    workspace.remove();
  });

  it('claims local first, then empty-1 and empty-2, in the order the windows start', () => {
    const names = [
      claimWindowName(claims),
      claimWindowName(claims),
      claimWindowName(claims),
    ];
    deepStrictEqual(names, ['local', 'empty-1', 'empty-2']);
  });

  it('skips a claim an earlier window took', () => {
    workspace.write('agent/claims/local', '');
    workspace.write('agent/claims/empty-1', '');
    strictEqual(claimWindowName(claims), 'empty-2');
  });

  it("writes a folder window's folder name to its pid file", () => {
    recordWindowName(pids, 42, windowNameOf('/home/harness/b'));
    strictEqual(readFileSync(path.join(pids, '42'), 'utf8'), 'b');
  });

  describe('folderWindowName', () => {
    function everyone(): boolean {
      return true;
    }
    const OWN_PROCESS = 99;

    it('tooling-91: gives the folder name when no window holds it', () => {
      strictEqual(
        folderWindowName('proj', new Map(), everyone, OWN_PROCESS),
        'proj',
      );
    });

    it('tooling-91: gives name-2 when a live window holds the folder name', () => {
      strictEqual(
        folderWindowName('proj', new Map([[1, 'proj']]), everyone, OWN_PROCESS),
        'proj-2',
      );
    });

    it('tooling-91: gives the folder name when the window that held it has ended', () => {
      strictEqual(
        folderWindowName(
          'proj',
          new Map([[1, 'proj']]),
          processId => processId !== 1,
          OWN_PROCESS,
        ),
        'proj',
      );
    });

    it('tooling-91: gives name-3 when live windows hold the folder name and name-2', () => {
      strictEqual(
        folderWindowName(
          'proj',
          new Map([
            [1, 'proj'],
            [2, 'proj-2'],
          ]),
          everyone,
          OWN_PROCESS,
        ),
        'proj-3',
      );
    });

    it('tooling-91: does not count the record of its own process', () => {
      strictEqual(
        folderWindowName(
          'proj',
          new Map([[OWN_PROCESS, 'proj']]),
          everyone,
          OWN_PROCESS,
        ),
        'proj',
      );
    });
  });

  it('tooling-91: reads the names of the pid files by process id, and not the authority files', () => {
    workspace.write('agent/pids/12', 'proj');
    workspace.write('agent/pids/13', 'proj-2');
    workspace.write('agent/pids/13.authority', 'x');
    deepStrictEqual(
      [...recordedWindowNames(pids)],
      [
        [12, 'proj'],
        [13, 'proj-2'],
      ],
    );
  });

  it('tooling-91: a folder with no pid files has no names', () => {
    deepStrictEqual([...recordedWindowNames(pids)], []);
  });

  it('tooling-91: a running process runs, the init process runs whoever may signal it, and one that ended does not', () => {
    const ended = spawnSync('true').pid;
    deepStrictEqual(
      [processRuns(process.pid), processRuns(1), processRuns(ended)],
      [true, true, false],
    );
  });
});
