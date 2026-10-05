import {deepStrictEqual, strictEqual} from 'node:assert';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {
  integrationConfigurations,
  runIntegrationTests,
  testCliBinary,
} from './integration-tests.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

describe('integration-tests', () => {
  let workspace: TemporaryWorkspace;
  let started: string[][];

  function recordingRunner(cliArguments: string[]): number {
    started.push(cliArguments);
    return 3;
  }

  beforeEach(() => {
    workspace = new TemporaryWorkspace('integration-tests');
    workspace.writeManifest('remote-a');
    workspace.writeManifest('remote-b');
    started = [];
  });

  afterEach(() => {
    workspace.remove();
  });

  it('finds the vscode-test binary of @vscode/test-cli', () => {
    strictEqual(existsSync(testCliBinary()), true);
  });

  it('configures only the packages that have test/integration', () => {
    workspace.write('packages/remote-b/test/integration/.keep', '');
    const directory = path.join(workspace.root, 'packages', 'remote-b');
    deepStrictEqual(integrationConfigurations(workspace.root), [
      {
        label: 'remote-b',
        extensionDevelopmentPath: directory,
        files: path.join(directory, 'dist/test/integration/**/*.test.js'),
      },
    ]);
  });

  it('does not start the editor when no package has integration tests', () => {
    strictEqual(runIntegrationTests(workspace.root, [], recordingRunner), 0);
    deepStrictEqual(started, []);
  });

  it('starts the runner with the arguments and returns its exit code', () => {
    workspace.write('packages/remote-a/test/integration/.keep', '');
    strictEqual(
      runIntegrationTests(
        workspace.root,
        ['--label', 'remote-a'],
        recordingRunner,
      ),
      3,
    );
    deepStrictEqual(started, [['--label', 'remote-a']]);
  });
});
