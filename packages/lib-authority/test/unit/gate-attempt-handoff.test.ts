import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {attemptHandoffOf} from '../../src/gate/vscode-setup.ts';

/** One window's copy of a value that the editor keeps whole for all the windows of a profile, and writes whole. */
class StaleCopy {
  private copy: Record<string, boolean>;
  private readonly shared: {value: Record<string, boolean>};

  constructor(shared: {value: Record<string, boolean>}) {
    this.shared = shared;
    this.copy = {...shared.value};
  }

  write(key: string, value: boolean): void {
    this.copy = {...this.copy, [key]: value};
    this.shared.value = this.copy;
  }

  read(key: string): boolean {
    return this.copy[key] ?? false;
  }
}

describe('the handoff of a failed attempt across a restart (card #3100, F-1403)', () => {
  let folder = '';

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'gate-attempt-'));
  });

  afterEach(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  it('the control: an attempt kept in a value that every window writes whole from its own copy is lost to a window that wrote its dismissal from a stale copy', () => {
    const shared = {value: {}};
    const reloading = new StaleCopy(shared);
    const other = new StaleCopy(shared);
    reloading.write('gate.attemptPending', true);
    other.write('gate.dismissed', true);
    deepStrictEqual(new StaleCopy(shared).read('gate.attemptPending'), false);
  });

  it('F-1403: the attempt left in a file of the extension’s storage survives what another window writes to the global state, and one window takes it', () => {
    const reloading = attemptHandoffOf(folder, () => 1000);
    const restarted = [
      attemptHandoffOf(folder, () => 2000),
      attemptHandoffOf(folder, () => 2000),
    ];
    const shared = {value: {}};
    return reloading.leave().then(() => {
      new StaleCopy(shared).write('gate.dismissed', true);
      deepStrictEqual(
        [
          restarted.map(window => window.pending()),
          restarted.map(window => window.take()),
          restarted.map(window => window.pending()),
          readdirSync(path.join(folder, 'handoffs', 'gate-attempt')),
        ],
        [[true, true], [true, false], [false, false], []],
      );
    });
  });

  it('an attempt that is not handed over is none, and a second leave is no second attempt', async () => {
    const window = attemptHandoffOf(folder, () => 1000);
    const before = [window.pending(), window.take()];
    await window.leave();
    await window.leave();
    deepStrictEqual(
      [before, window.take(), window.take()],
      [[false, false], true, false],
    );
  });
});
