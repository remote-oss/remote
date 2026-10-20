import {deepStrictEqual, strictEqual} from 'node:assert';
import type {
  ConnectionState,
  DecodedTarget,
  ResourceLabelFormatter,
} from 'lib-authority';
import {registerWindowLabel} from '../../src/surfaces/label-formatter.ts';
import type {Translate} from '../../src/surfaces/strings.ts';

function same(template: string): string {
  return template;
}

function german(template: string): string {
  return template === 'SSH: {0}' ? 'SSH-Host: {0}' : template;
}

/** A label formatter host that records the formatters it is given and counts their disposals. */
class FakeFormatterHost {
  readonly formatters: ResourceLabelFormatter[] = [];
  disposals = 0;

  registerResourceLabelFormatter(formatter: ResourceLabelFormatter): {
    dispose(): void;
  } {
    this.formatters.push(formatter);
    return {
      dispose: () => {
        this.disposals += 1;
      },
    };
  }
}

interface CurrentConnection {
  decodedTarget: DecodedTarget;
  state: ConnectionState;
}

/** A resolver handle whose first settle the test fires, with the connection it answers. */
function fakeResolver() {
  let listener: (() => void) | undefined;
  let connection: CurrentConnection | undefined;
  const resolver = {
    currentConnection: (): CurrentConnection | undefined => connection,
    onFirstResolveSettled: (callback: () => void): void => {
      listener = callback;
    },
  };
  function settled(value: CurrentConnection | undefined): void {
    connection = value;
    listener?.();
  }
  return {resolver, settled};
}

/** The host, the fake resolver and the registration of one row, ready to settle. */
function freshRow(translate: Translate = same) {
  const host = new FakeFormatterHost();
  const {resolver, settled} = fakeResolver();
  const handle = registerWindowLabel(resolver, host, translate);
  return {host, handle, settled};
}

/** A decoded ssh target, plain as written. */
function sshTarget(rawHostString: string): DecodedTarget {
  return {
    family: 'ssh-remote',
    target: {kind: 'plain', text: rawHostString},
    rawHostString,
  };
}

/** A decoded wsl target: its shape has no kind. */
function wslTarget(): DecodedTarget {
  return {
    family: 'wsl',
    target: {distro: 'ubuntu'},
    rawHostString: 'wsl+ubuntu',
  };
}

describe('the window label of the connected resolve', () => {
  it('F-2502 BR-2: a connected first resolve registers one formatter with the host suffix', () => {
    const {host, settled} = freshRow();
    settled({decodedTarget: sshTarget('dev'), state: 'connected'});
    deepStrictEqual(
      [host.formatters.length, host.formatters[0]?.formatting.workspaceSuffix],
      [1, 'SSH: dev'],
    );
  });

  it('F-2502 BR-2: the same resolve registers the authority as written', () => {
    const {host, settled} = freshRow();
    settled({decodedTarget: sshTarget('dev'), state: 'connected'});
    deepStrictEqual(host.formatters[0]?.authority, 'ssh-remote+dev');
  });

  it('F-2502 BR-3, AC-14: the alias of a user and port target is the suffix', () => {
    const {host, settled} = freshRow();
    settled({
      decodedTarget: sshTarget('alex@my-alias:22'),
      state: 'connected',
    });
    deepStrictEqual(
      host.formatters[0]?.formatting.workspaceSuffix,
      'SSH: my-alias',
    );
  });

  it('F-2502 AC-34: a failed first resolve registers nothing', () => {
    const {host, settled} = freshRow();
    settled({decodedTarget: sshTarget('dev'), state: 'failed'});
    strictEqual(host.formatters.length, 0);
  });

  it('F-2502 AC-34: no connection when the listener runs registers nothing', () => {
    const {host, settled} = freshRow();
    settled(undefined);
    strictEqual(host.formatters.length, 0);
  });

  it('F-2502 BR-2: a target that is not ssh-remote registers nothing', () => {
    const {host, settled} = freshRow();
    settled({decodedTarget: wslTarget(), state: 'connected'});
    strictEqual(host.formatters.length, 0);
  });

  it('F-2502 BR-2: nothing settled yet registers nothing', () => {
    const {host} = freshRow();
    strictEqual(host.formatters.length, 0);
  });

  it('F-2502 BR-2: dispose after a connected resolve disposes the registration once', () => {
    const {host, handle, settled} = freshRow();
    settled({decodedTarget: sshTarget('dev'), state: 'connected'});
    handle.dispose();
    deepStrictEqual([host.formatters.length, host.disposals], [1, 1]);
  });

  it('F-2502 BR-2: dispose twice after a connected resolve disposes once', () => {
    const {host, handle, settled} = freshRow();
    settled({decodedTarget: sshTarget('dev'), state: 'connected'});
    handle.dispose();
    handle.dispose();
    strictEqual(host.disposals, 1);
  });

  it('F-2502 AC-34: dispose after a failed resolve throws nothing and disposes nothing', () => {
    const {host, handle, settled} = freshRow();
    settled({decodedTarget: sshTarget('dev'), state: 'failed'});
    handle.dispose();
    strictEqual(host.disposals, 0);
  });

  it('F-2502 BR-2: a dispose before the first resolve settles disposes the late registration', () => {
    const {host, handle, settled} = freshRow();
    handle.dispose();
    settled({decodedTarget: sshTarget('dev'), state: 'connected'});
    deepStrictEqual([host.formatters.length, host.disposals], [1, 1]);
  });

  it('R-29: a connected resolve with a translated table registers the translated suffix', () => {
    const {host, settled} = freshRow(german);
    settled({decodedTarget: sshTarget('dev'), state: 'connected'});
    deepStrictEqual(
      host.formatters[0]?.formatting.workspaceSuffix,
      'SSH-Host: dev',
    );
  });
});
