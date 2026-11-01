import {deepStrictEqual} from 'node:assert';
import {createLogger, type Level, type LogLine} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  enablePortsViewWhenConnected,
  PORTS_VIEW_KEY,
  type ConnectionState,
  type DecodedTarget,
} from '../../src/index.ts';

/** The decoded target of an ssh host, plain as written. */
function sshTarget(rawHostString: string): DecodedTarget {
  return {
    family: 'ssh-remote',
    target: {text: rawHostString, kind: 'plain'},
    rawHostString,
  };
}

interface CurrentConnection {
  state: ConnectionState;
  decodedTarget: DecodedTarget;
}

/** A resolver handle whose first settle the test fires, with the connection it answers. */
function fakeResolver() {
  let firstSettle: (() => void) | undefined;
  let connection: CurrentConnection | undefined;
  const handle = {
    onFirstResolveSettled: (callback: () => void): void => {
      firstSettle = callback;
    },
    // The rows never start a resolve, so the start listener never runs.
    onFirstResolveStarted: (): void => undefined,
    currentConnection: (): CurrentConnection | undefined => connection,
  };
  function settled(value: CurrentConnection | undefined): void {
    connection = value;
    firstSettle?.();
  }
  return {resolver: handle, settled};
}

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
  it('connect-33, containers-85: a connected first resolve enables the Ports view once', () => {
    const ports = portsRow();
    ports.settled({decodedTarget: sshTarget('dev'), state: 'connected'});
    deepStrictEqual(ports.enabledCount(), 1);
  });

  for (const state of ['failed', 'transportLost', 'transportClosed'] as const) {
    it(`connect-33, containers-85: a first resolve that settles as ${state} does not enable the Ports view`, () => {
      const ports = portsRow();
      ports.settled({decodedTarget: sshTarget('dev'), state});
      deepStrictEqual(ports.enabledCount(), 0);
    });
  }

  it('connect-33, containers-85: a first resolve that settles with no connection does not enable the Ports view', () => {
    const ports = portsRow();
    ports.settled(undefined);
    deepStrictEqual(ports.enabledCount(), 0);
  });

  it('connect-33, containers-85: the Ports view is not enabled before the first resolve settles', () => {
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
