import {deepStrictEqual, strictEqual} from 'node:assert';
import type {
  ConnectionState,
  DecodedTarget,
  ResourceLabelFormatter,
} from 'lib-authority';
import {createLogger, type Level, type LogLine} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  enablePortsViewWhenConnected,
  PORTS_VIEW_KEY,
  registerWindowLabel,
} from '../../src/surfaces/label-formatter.ts';
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

/** The Ports view host that counts, refuses on demand with an error or any other value, and the log it warns to. */
function portsRowWith(refusal?: unknown) {
  const {resolver, settled} = fakeResolver();
  let enabled = 0;
  const sink = new MemorySink();
  enablePortsViewWhenConnected(
    resolver,
    {
      enablePortsView: () => {
        enabled += 1;
        // The editor's refusal may be any value, so the fake is a thenable that refuses with it.
        return refusal === undefined
          ? Promise.resolve()
          : ({
              then: (
                fulfilled: unknown,
                reject?: ((reason: unknown) => unknown) | null,
              ) => reject?.(refusal),
            } as unknown as PromiseLike<never>);
      },
    },
    createLogger(sink, {minimumLevel: (): Level => 'info'}),
  );
  return {
    settled,
    enabledCount: (): number => enabled,
    warnings: (): LogLine[] => sink.lines.filter(line => line.level === 'warn'),
  };
}

/** The Ports view ports that refuses with an error. */
function portsRow(refusal?: Error) {
  return portsRowWith(refusal);
}

/** Lets the promises that are ready run. */
async function turn(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await Promise.resolve();
  }
}

describe("core's Ports view of the connected window (card connect-33)", () => {
  it('F-2501 AC-35: a connected first resolve enables the Ports view once', () => {
    const ports = portsRow();
    ports.settled({decodedTarget: sshTarget('dev'), state: 'connected'});
    deepStrictEqual(ports.enabledCount(), 1);
  });

  for (const state of ['failed', 'transportLost', 'transportClosed'] as const) {
    it(`F-2501 AC-35: a first resolve that settles as ${state} does not enable the Ports view`, () => {
      const ports = portsRow();
      ports.settled({decodedTarget: sshTarget('dev'), state});
      deepStrictEqual(ports.enabledCount(), 0);
    });
  }

  it('F-2501 AC-35: a first resolve that settles with no connection does not enable the Ports view', () => {
    const ports = portsRow();
    ports.settled(undefined);
    deepStrictEqual(ports.enabledCount(), 0);
  });

  it('F-2501 AC-35: the Ports view is not enabled before the first resolve settles', () => {
    deepStrictEqual(portsRow().enabledCount(), 0);
  });

  it("connect-33: the Ports view's enabling failure is logged and nothing else changes", async () => {
    const ports = portsRow(new Error('no such context'));
    ports.settled({decodedTarget: sshTarget('dev'), state: 'connected'});
    await turn();
    deepStrictEqual(
      ports.warnings().map(line => line.message),
      ['the Ports view could not be enabled: no such context'],
    );
  });

  it('connect-33: a refusal that is not an error is logged by its text', async () => {
    const ports = portsRow();
    const failing = portsRowWith('plain refusal');
    failing.settled({decodedTarget: sshTarget('dev'), state: 'connected'});
    await turn();
    deepStrictEqual(
      [ports.warnings().length, failing.warnings().map(line => line.message)],
      [0, ['the Ports view could not be enabled: plain refusal']],
    );
  });

  it("connect-33: the key core's Ports view reads is forwardedPortsViewEnabled", () => {
    deepStrictEqual(PORTS_VIEW_KEY, 'forwardedPortsViewEnabled');
  });
});
