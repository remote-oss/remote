import {deepStrictEqual} from 'node:assert';
import type {ConnectInput, ConnectPhase} from 'lib-authority';
import type {TransferPhase} from 'lib-server';
import {connectorOf, type SshConnector} from '../../src/pipeline/connector.ts';
import type {ConnectSteps} from '../../src/pipeline/steps.ts';
import {
  endTunnel,
  INPUT,
  type Recording,
  setup,
  steps,
  tunnelFails,
} from './pipeline.fixture.ts';

/** The host's input for the fixture's connect: the same target and attempt, as the resolver host passes it. */
const HOST_INPUT: ConnectInput = {...INPUT, target: INPUT.target};

/** A connector over the fixture's steps, with the recording, and a log the details reveal counts in. */
function connectorFor(changes: Partial<ConnectSteps> = {}): {
  connector: SshConnector;
  recording: Recording;
  revealed: string[];
} {
  const {recording, options} = setup();
  const {maximumReconnectionAttempts, preconnectMilliseconds, logger} = options;
  const revealed: string[] = [];
  return {
    connector: connectorOf({
      stepsFor: () => steps(recording, changes),
      options: {maximumReconnectionAttempts, preconnectMilliseconds, logger},
      revealLog: () => {
        revealed.push('log');
      },
    }),
    recording,
    revealed,
  };
}

describe('the connector over the connect pipeline', () => {
  it('contracts §3.2: a connect that works gives the connection the window gets', async () => {
    const {connector} = connectorFor();
    const result = await connector.connect(HOST_INPUT);
    deepStrictEqual('address' in result ? result.address.port : result, 50000);
  });

  it('contracts §3.2: a connect that fails gives the failure', async () => {
    const {connector} = connectorFor({openTunnel: tunnelFails});
    const result = await connector.connect(HOST_INPUT);
    deepStrictEqual('kind' in result ? result.kind : result, 'channelClosed');
  });

  it('contracts §3.2: a target that is not an ssh one fails with no reason, before any step', async () => {
    const {connector, recording} = connectorFor();
    const result = await connector.connect({
      ...HOST_INPUT,
      target: {distro: 'Ubuntu'},
    });
    deepStrictEqual(
      [
        'kind' in result ? [result.kind, result.reason] : result,
        recording.calls,
      ],
      [['unknown', undefined], []],
    );
  });

  /** What the phase listeners hear for a connect whose transfer reports `phase`. */
  async function phasesHeard(phase: TransferPhase): Promise<ConnectPhase[]> {
    const {connector} = connectorFor({
      transfer: (...given) => {
        const onPhase = given[4];
        onPhase(phase);
        return Promise.resolve({
          kind: 'transferred',
          installFolder: '/home/dev/.server/bin/abc',
        });
      },
    });
    const heard: ConnectPhase[] = [];
    connector.onPhase(given => {
      heard.push(given);
    });
    await connector.connect(HOST_INPUT);
    return heard;
  }

  it('F-2304: the stages of the connect reach the phase listeners', async () => {
    deepStrictEqual((await phasesHeard({kind: 'downloading'})).slice(0, 2), [
      {name: 'initializing'},
      {name: 'downloading'},
    ]);
  });

  it('F-2304: a percentage stage keeps its share', async () => {
    const heard = await phasesHeard({
      kind: 'progress',
      step: 'download',
      percent: 40,
    });
    deepStrictEqual(
      heard.find(given => given.name === 'serverDownloadPercent'),
      {name: 'serverDownloadPercent', percent: 40},
    );
  });

  it('contracts §3.2: a removed phase listener hears nothing more', async () => {
    const {connector} = connectorFor();
    const heard: ConnectPhase[] = [];
    const remove = connector.onPhase(phase => {
      heard.push(phase);
    });
    remove();
    await connector.connect(HOST_INPUT);
    deepStrictEqual(heard, []);
  });

  it('contracts §3.2: a phase listener that throws keeps neither the others nor the connect from going on', async () => {
    const {connector} = connectorFor();
    connector.onPhase(() => {
      throw new Error('a listener fault');
    });
    const heard: ConnectPhase[] = [];
    connector.onPhase(phase => {
      heard.push(phase);
    });
    const result = await connector.connect(HOST_INPUT);
    deepStrictEqual(['address' in result, heard.length > 0], [true, true]);
  });

  it('contracts §3.2: a cancel during the connect aborts it', async () => {
    let signal: AbortSignal | undefined;
    const {connector} = connectorFor({
      decideTerms: (...given) => {
        signal = given[1];
        connector.cancel();
        return Promise.resolve({
          kind: 'failed',
          failure: {kind: 'cancelled'},
        });
      },
    });
    await connector.connect(HOST_INPUT);
    deepStrictEqual(signal?.aborted, true);
  });

  it('contracts §3.2: a cancel after a connect releases the connection once', async () => {
    const {connector, recording} = connectorFor();
    await connector.connect(HOST_INPUT);
    connector.cancel();
    connector.cancel();
    deepStrictEqual(recording.releases, 1);
  });

  it('contracts §3.2: a connection that completes after a cancel is given back, not held', async () => {
    const window: {connector?: SshConnector} = {};
    const {connector, recording} = connectorFor({
      rememberPlatform: () => {
        // The window is torn down after the tunnel opened, before the connect returns.
        window.connector?.cancel();
        return Promise.resolve();
      },
    });
    window.connector = connector;
    const result = await connector.connect(HOST_INPUT);
    connector.cancel();
    deepStrictEqual(
      ['kind' in result ? result.kind : result, recording.releases],
      ['cancelled', 1],
    );
  });

  it('F-2505: a connect after one that worked releases the first', async () => {
    const {connector, recording} = connectorFor();
    await connector.connect(HOST_INPUT);
    await connector.connect({...HOST_INPUT, attempt: 2, isReconnection: true});
    deepStrictEqual(recording.releases, 1);
  });

  /** Which transport listeners hear `notice` sent through the lease of a connection that worked. */
  async function transportHeard(
    notice: Parameters<NonNullable<Recording['notice']>>[0],
  ): Promise<string[]> {
    const {connector, recording} = connectorFor();
    const heard: string[] = [];
    connector.onTransportLost(() => {
      heard.push('lost');
    });
    connector.onTransportClosed(() => {
      heard.push('closed');
    });
    await connector.connect(HOST_INPUT);
    recording.notice?.(notice);
    return heard;
  }

  it('contracts §3.2: a lost transport reaches the lost listeners only', async () => {
    deepStrictEqual(await transportHeard({type: 'transportLost'}), ['lost']);
  });

  it('contracts §3.2: the end of the connection server reaches the closed listeners', async () => {
    deepStrictEqual(await transportHeard({type: 'helperGone'}), ['closed']);
  });

  it('contracts §3.2: a connection given back by a cancel is not heard any more', async () => {
    const {connector, recording} = connectorFor();
    const heard: string[] = [];
    connector.onTransportLost(() => {
      heard.push('lost');
    });
    await connector.connect(HOST_INPUT);
    const send = recording.notice;
    connector.cancel();
    send?.({type: 'transportLost'});
    deepStrictEqual([heard, recording.notice], [[], undefined]);
  });

  /** A connector holding a connection that worked, with what its lost listeners hear. */
  async function heldConnector() {
    const {connector, recording} = connectorFor();
    const heard: string[] = [];
    connector.onTransportLost(() => {
      heard.push('lost');
    });
    await connector.connect(HOST_INPUT);
    return {connector, recording, heard};
  }

  it('F-2505 BR-1: a held connection whose tunnel ends reaches the lost listeners', async () => {
    const {recording, heard} = await heldConnector();
    endTunnel(recording, 'listener failed');
    deepStrictEqual(heard, ['lost']);
  });

  it('contracts §3.2: a tunnel end after a cancel is not heard any more', async () => {
    const {connector, recording, heard} = await heldConnector();
    connector.cancel();
    endTunnel(recording, 'listener failed');
    deepStrictEqual(heard, []);
  });

  it('connect-14: each connect makes its own steps', async () => {
    const {recording, options} = setup();
    const {maximumReconnectionAttempts, preconnectMilliseconds, logger} =
      options;
    let made = 0;
    const connector = connectorOf({
      stepsFor: () => {
        made += 1;
        return steps(recording);
      },
      options: {maximumReconnectionAttempts, preconnectMilliseconds, logger},
      revealLog: () => undefined,
    });
    await connector.connect(HOST_INPUT);
    await connector.connect({...HOST_INPUT, attempt: 2, isReconnection: true});
    deepStrictEqual(made, 2);
  });

  it('F-2509 BR-5: the held connection gives its server port', async () => {
    const {connector} = connectorFor();
    await connector.connect(HOST_INPUT);
    deepStrictEqual(connector.serverPort(), 4321);
  });

  it('F-2509 AC-13: before any connect there is no server port, and no throw', () => {
    const {connector} = connectorFor();
    deepStrictEqual(connector.serverPort(), 'none');
  });

  it('F-2509 AC-13: a connect that failed leaves no server port', async () => {
    const {connector} = connectorFor({openTunnel: tunnelFails});
    await connector.connect(HOST_INPUT);
    deepStrictEqual(connector.serverPort(), 'none');
  });

  it('F-2509 AC-13: once the transport is lost there is no server port until a connect works again', async () => {
    const {connector, recording} = connectorFor();
    await connector.connect(HOST_INPUT);
    recording.notice?.({type: 'transportLost'});
    deepStrictEqual(connector.serverPort(), 'none');
  });

  it('F-2509 AC-20: a connect after a lost transport gives the new server port', async () => {
    const {connector, recording} = connectorFor();
    await connector.connect(HOST_INPUT);
    recording.notice?.({type: 'transportLost'});
    await connector.connect({...HOST_INPUT, attempt: 2, isReconnection: true});
    deepStrictEqual(connector.serverPort(), 4321);
  });

  it('F-2509 AC-13: after a cancel there is no server port', async () => {
    const {connector} = connectorFor();
    await connector.connect(HOST_INPUT);
    connector.cancel();
    deepStrictEqual(connector.serverPort(), 'none');
  });

  it('F-2509: the end of the connection server keeps the port until the window connects again', async () => {
    const {connector, recording} = connectorFor();
    await connector.connect(HOST_INPUT);
    recording.notice?.({type: 'helperGone'});
    deepStrictEqual(connector.serverPort(), 4321);
  });

  it('F-2304 BR-12: the details reveal the log', () => {
    const {connector, revealed} = connectorFor();
    connector.revealDetails();
    deepStrictEqual(revealed, ['log']);
  });
});
