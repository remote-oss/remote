import {deepStrictEqual} from 'node:assert';
import {cliPathsOf} from '../../src/cli/cli-paths.ts';

describe('the paths of the dev container CLI (card containers-04)', () => {
  it('C3: the entry and the preload are under the extension’s dist folder', () => {
    deepStrictEqual(cliPathsOf('/ext', '/app'), {
      entry: '/ext/dist/devcontainers-cli/devcontainer.js',
      preload: '/ext/dist/cli-preload.js',
      editorModules: '/app/node_modules.asar',
    });
  });

  it("ADR-0011: editorModules is the editor's node_modules.asar", () => {
    deepStrictEqual(
      cliPathsOf('/ext', '/app').editorModules,
      '/app/node_modules.asar',
    );
  });
});
