import {deepStrictEqual} from 'node:assert';
import {askpassEndpointPath, launcherPath} from '../../src/index.ts';

describe('askpass paths', () => {
  it('names the endpoint ra- and 16 hex digits, in the runtime folder', () => {
    deepStrictEqual(
      /^\/run\/ra-[0-9a-f]{16}\.sock$/.test(
        askpassEndpointPath('linux', '/run', 'helper', 'nonce'),
      ),
      true,
    );
  });

  it('names the Windows endpoint a pipe, with the same digest and no folder', () => {
    const socket = askpassEndpointPath('linux', '/run', 'helper', 'nonce');
    const pipe = askpassEndpointPath('win32', '/run', 'helper', 'nonce');
    deepStrictEqual(
      [/^\\\\\.\\pipe\\ra-[0-9a-f]{16}$/.test(pipe), pipe.slice(-16)],
      [true, socket.slice(-21, -5)],
    );
  });

  it('gives another endpoint to another nonce', () => {
    deepStrictEqual(
      askpassEndpointPath('linux', '/run', 'helper', 'one') ===
        askpassEndpointPath('linux', '/run', 'helper', 'two'),
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
