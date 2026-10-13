import {deepStrictEqual, strictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  claimWindowName,
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
});
