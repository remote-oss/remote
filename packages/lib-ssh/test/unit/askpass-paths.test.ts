import {deepStrictEqual} from 'node:assert';
import {askpassEndpointPath, launcherPath} from '../../src/index.ts';

describe('askpass paths', () => {
  it('names the endpoint ra- and 16 hex digits, in the runtime folder', () => {
    deepStrictEqual(
      /^\/run\/ra-[0-9a-f]{16}\.sock$/.test(
        askpassEndpointPath('/run', 'helper', 'nonce'),
      ),
      true,
    );
  });

  it('gives another endpoint to another nonce', () => {
    deepStrictEqual(
      askpassEndpointPath('/run', 'helper', 'one') ===
        askpassEndpointPath('/run', 'helper', 'two'),
      false,
    );
  });

  it('names the launcher rh-askpass- and 16 hex digits, in the launcher folder', () => {
    deepStrictEqual(
      /^\/run\/rh-askpass\/rh-askpass-[0-9a-f]{16}$/.test(
        launcherPath('/run', 'text'),
      ),
      true,
    );
  });

  it('gives equal texts one launcher and other texts another', () => {
    deepStrictEqual(
      [
        launcherPath('/run', 'one') === launcherPath('/run', 'one'),
        launcherPath('/run', 'one') === launcherPath('/run', 'two'),
      ],
      [true, false],
    );
  });
});
