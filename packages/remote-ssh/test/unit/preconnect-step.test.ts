import {deepStrictEqual} from 'node:assert';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {connect} from '../../src/pipeline/connect.ts';
import {preconnectStep} from '../../src/pipeline/preconnect-step.ts';
import type {ConnectInput} from '../../src/pipeline/steps.ts';
import {INPUT, setup, steps} from './pipeline.fixture.ts';

/** The alias of the fixture's input, `dev`. */
const ALIAS = 'dev';

/** The host part of the typed `alex@box:2222`. */
const TYPED_HOST = 'box';

/** The step over `setting`, run once for `input`, with what it logged. */
async function ranWith(
  setting: unknown,
  input: ConnectInput = INPUT,
): Promise<{
  result: Awaited<ReturnType<ReturnType<typeof preconnectStep>>>;
  logged: string[];
}> {
  const sink = new MemorySink();
  const step = preconnectStep({
    setting: () => setting,
    logger: createLogger(sink, {minimumLevel: (): Level => 'info'}),
  });
  const result = await step(input, new AbortController().signal);
  return {result, logged: sink.lines.map(line => line.message)};
}

describe('the pre-connection script step, until the runner exists', () => {
  it('F-2108 6.6: with no script the connect goes on', async () => {
    const {result} = await ranWith('');
    deepStrictEqual(result, {kind: 'done', value: undefined});
  });

  it('F-2108 6.6: with no script nothing is logged', async () => {
    const {logged} = await ranWith(undefined);
    deepStrictEqual(logged, []);
  });

  it('F-2108 6.5 step 3: a script for another alias lets the connect go on', async () => {
    const {result} = await ranWith({other: '/home/a/renew.sh'});
    deepStrictEqual(result, {kind: 'done', value: undefined});
  });

  it('F-2108 6.5 step 4: a null entry for the alias lets the connect go on', async () => {
    const {result} = await ranWith({[ALIAS]: null});
    deepStrictEqual(result, {kind: 'done', value: undefined});
  });

  it('#140 R3 interim: a script for every host fails the connect, with no reason', async () => {
    const {result} = await ranWith('/home/a/renew.sh');
    deepStrictEqual(result, {
      kind: 'failed',
      failure: {kind: 'preconnectFailed'},
    });
  });

  it('#140 R3 interim: a script for the alias fails the connect', async () => {
    const {result} = await ranWith({[ALIAS]: '/home/a/renew.sh'});
    deepStrictEqual(result, {
      kind: 'failed',
      failure: {kind: 'preconnectFailed'},
    });
  });

  it('F-2108 BR-2: the alias of a typed user@host:port is the host alone', async () => {
    const {result} = await ranWith(
      {[TYPED_HOST]: '/home/a/renew.sh'},
      {...INPUT, target: {kind: 'plain', text: 'alex@box:2222'}},
    );
    deepStrictEqual(result.kind, 'failed');
  });

  it('F-2003: the log names the cause', async () => {
    const {logged} = await ranWith('/home/a/renew.sh');
    deepStrictEqual(logged, [
      'a pre-connection script is set for this host, and running one is not built yet',
    ]);
  });

  it('F-2108 BR-11: a reconnection does not run the step, so it is not failed by it', async () => {
    const {recording, options} = setup();
    const sink = new MemorySink();
    const result = await connect(
      {...INPUT, attempt: 2, isReconnection: true},
      steps(recording, {
        preconnect: preconnectStep({
          setting: () => '/home/a/renew.sh',
          logger: createLogger(sink, {minimumLevel: (): Level => 'info'}),
        }),
      }),
      options,
    );
    deepStrictEqual('connected' in result, true);
  });
});
