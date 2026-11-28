import {deepStrictEqual} from 'node:assert';
import {CONTAINERS_CLI_FOLDER} from '../../src/index.ts';

describe('the folder of the dev container CLI on a remote host', () => {
  it('ADR-0009: is the one name that names it under the data folder of the editor’s server', () => {
    deepStrictEqual(CONTAINERS_CLI_FOLDER, 'remote-oss-containers-cli');
  });
});
