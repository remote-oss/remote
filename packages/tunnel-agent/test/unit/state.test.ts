import {deepStrictEqual} from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  readStateFile,
  readTunnelRecord,
  stateFolderOf,
  writeStateFile,
  writeTunnelRecord,
} from '../../src/state.ts';

/** The permission bits of `file`. */
function modeOf(file: string): number {
  return statSync(file).mode & 0o777;
}

describe("the agent's state folder", () => {
  let home = '';
  let folder = '';

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'agent-state-'));
    folder = stateFolderOf(home);
  });

  afterEach(() => {
    rmSync(home, {recursive: true, force: true});
  });

  it('is the hidden folder named after the agent in the home folder', () => {
    deepStrictEqual(folder, path.join(home, '.remote-oss-tunnel-agent'));
  });

  it('is made at mode 0700, and an existing folder is given that mode, with each file written at 0600', () => {
    writeStateFile(folder, 'credential', 'secret');
    const made = modeOf(folder);
    rmSync(folder, {recursive: true});
    mkdirSync(folder, {mode: 0o755});
    writeStateFile(folder, 'host-key', 'key');
    deepStrictEqual(
      [made, modeOf(folder), modeOf(path.join(folder, 'host-key'))],
      [0o700, 0o700, 0o600],
    );
  });

  it('replaces a file whole and leaves no temporary file behind', () => {
    writeStateFile(folder, 'credential', 'first');
    writeStateFile(folder, 'credential', 'second');
    deepStrictEqual(
      [readStateFile(folder, 'credential'), readdirSync(folder)],
      ['second', ['credential']],
    );
  });

  it('reads a missing file as none, and fails on a file it cannot read', () => {
    mkdirSync(path.join(folder, 'host-key'), {recursive: true});
    let failure = '';
    try {
      readStateFile(folder, 'host-key');
    } catch (caught) {
      failure = (caught as NodeJS.ErrnoException).code ?? '';
    }
    deepStrictEqual(
      [readStateFile(folder, 'credential'), failure],
      [undefined, 'EISDIR'],
    );
  });

  it('keeps the tunnel record it writes', () => {
    const record = {tunnelId: 'calm-river', clusterId: 'local', name: 'box'};
    writeTunnelRecord(folder, record);
    deepStrictEqual(readTunnelRecord(folder), record);
  });

  it('reads no record from a missing file, one that is not JSON, not an object, or short of a name', () => {
    const seen = [readTunnelRecord(folder)];
    mkdirSync(folder);
    for (const text of [
      'not json',
      'null',
      '"text"',
      '{"tunnelId":"calm-river","clusterId":"local"}',
      '{"tunnelId":"calm-river","clusterId":"local","name":""}',
      '{"tunnelId":7,"clusterId":"local","name":"box"}',
    ]) {
      writeFileSync(path.join(folder, 'tunnel.json'), text);
      seen.push(readTunnelRecord(folder));
    }
    deepStrictEqual(seen, Array<undefined>(7).fill(undefined));
  });
});
