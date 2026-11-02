import {deepStrictEqual, strictEqual} from 'node:assert';
import {openOwnSettings} from '../../src/settings/settings-command.ts';

describe('openOwnSettings', () => {
  it('F-0102: runs workbench.action.openSettings once, with @ext:<the id>', () => {
    const calls: Array<[string, readonly unknown[]]> = [];
    function runCommand(command: string, ...parameters: unknown[]) {
      calls.push([command, parameters]);
      return Promise.resolve();
    }
    openOwnSettings(runCommand, 'remote-oss.remote-containers')();
    deepStrictEqual(calls, [
      ['workbench.action.openSettings', ['@ext:remote-oss.remote-containers']],
    ]);
  });

  it('F-0102: returns the run itself', () => {
    const runPromise = Promise.resolve('settled');
    function runCommand() {
      return runPromise;
    }
    strictEqual(
      openOwnSettings(runCommand, 'remote-oss.remote-containers')(),
      runPromise,
    );
  });
});
