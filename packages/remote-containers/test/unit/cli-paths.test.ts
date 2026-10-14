import {deepStrictEqual} from 'node:assert';
import {cliPathsOf} from '../../src/cli/cli-paths.ts';

describe('the paths of the dev container CLI (card containers-04)', () => {
  it('C3: the entry and the preload are under the extension’s dist folder', () => {
    deepStrictEqual(cliPathsOf('/ext'), {
      entry: '/ext/dist/devcontainers-cli/devcontainer.js',
      preload: '/ext/dist/cli-preload.js',
    });
  });
});
