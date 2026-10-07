/**
 * @fileoverview The contract every host channel implementation passes, as cases a test file hands to its runner.
 * An implementation's harness stages each scenario on its own transport. No bundle imports this module.
 */

import {deepStrictEqual, notStrictEqual} from 'node:assert';
import {createHash} from 'node:crypto';
import {
  hostPathOf,
  type ChannelFailureKind,
  type CopyOutcome,
  type CopyRequest,
  type HostChannel,
  type ScriptOutcome,
  type ScriptRequest,
} from '../host-channel.ts';

/** A situation the harness sets up on its transport before the case calls the channel. */
export type ContractScenario =
  | {kind: 'printsLines'; lines: readonly string[]; status: number}
  | {kind: 'printsUntilCancelled'; lines: readonly string[]}
  | {kind: 'scriptFails'; failure: ChannelFailureKind}
  | {kind: 'failsThenSucceeds'; failure: ChannelFailureKind}
  | {kind: 'copies'}
  | {kind: 'copyFails'; failure: ChannelFailureKind}
  // The script prints the lowercase hex SHA-256 of all it reads, then exits 0. The request's input is the text,
  // or a local file the harness fills with the content.
  | {
      kind: 'digestsInput';
      input: {kind: 'text'; text: string} | {kind: 'file'; content: Uint8Array};
    }
  // The request's input names a local file that does not exist.
  | {kind: 'missingInputFile'}
  // The request's input is a local file; the script prints the lines, then waits.
  | {kind: 'streamsUntilCancelled'; lines: readonly string[]}
  // The copy request's local file is one the host can, or cannot, read directly.
  | {kind: 'clientFile'; reachable: boolean};

/** A channel with the scenario in place, and the requests that play it out on this transport. */
export interface StagedChannel {
  channel: HostChannel;
  script: Omit<ScriptRequest, 'cancellation'>;
  copy: Omit<CopyRequest, 'cancellation'>;
  /** For a `clientFile` scenario, the host path expected for the copy request's local file. */
  hostPath?: string;
}

/** What an implementation provides to run the contract on its transport. */
export interface ChannelHarness {
  /** The failure kinds this transport can be made to produce from `runScript`. */
  scriptFailures: readonly ChannelFailureKind[];
  /** The failure kinds this transport can be made to produce from `copyToHost`. */
  copyFailures: readonly ChannelFailureKind[];
  /** Whether the host can read some client files directly. */
  reachesClientFiles: boolean;
  stage(scenario: ContractScenario): Promise<StagedChannel>;
}

/** One case of the contract: its name, and a check that rejects when the channel breaks the contract. */
export interface ContractCase {
  name: string;
  check: () => Promise<void>;
}

const PRINTED_LINES = ['first line', 'second line', 'third line'];

/** Every byte value, then a CR LF pair and a NUL, so that any translation of the stream shows. */
const STREAMED_CONTENT = Uint8Array.from([
  ...Array.from({length: 256}).keys(),
  0x0d,
  0x0a,
  0x00,
]);

const TEXT_INPUT = 'première ligne\nzweite Zeile\n';

function digestOf(content: Uint8Array | string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Runs the staged script, collecting its lines; `onLine` may act on the controller as lines arrive. */
async function runCollecting(
  staged: StagedChannel,
  controller: AbortController,
  onLine: (line: string) => void = () => undefined,
): Promise<{lines: string[]; outcome: ScriptOutcome}> {
  const lines: string[] = [];
  const outcome = await staged.channel.runScript(
    {...staged.script, cancellation: controller.signal},
    line => {
      lines.push(line);
      onLine(line);
    },
  );
  return {lines, outcome};
}

/** `failed:<kind>` for a failure that kept the transport's message, else the outcome's own kind. */
function failureKindOf(outcome: ScriptOutcome | CopyOutcome): string {
  if (outcome.kind !== 'failed') {
    return outcome.kind;
  }
  notStrictEqual(outcome.failure.detail, '');
  return `failed:${outcome.failure.kind}`;
}

/** Stages a script that prints its lines and waits, cancels it at the first line, and expects `cancelled`. */
async function cancelsOnFirstLine(
  harness: ChannelHarness,
  scenario: Extract<
    ContractScenario,
    {kind: 'printsUntilCancelled' | 'streamsUntilCancelled'}
  >,
): Promise<void> {
  const staged = await harness.stage(scenario);
  const controller = new AbortController();
  const {lines, outcome} = await runCollecting(staged, controller, () => {
    controller.abort();
  });
  deepStrictEqual(
    [lines, failureKindOf(outcome)],
    [scenario.lines.slice(0, 1), 'failed:cancelled'],
  );
}

function retryCases(harness: ChannelHarness): ContractCase[] {
  const failure = harness.scriptFailures[0];
  if (failure === undefined) {
    return [];
  }
  return [
    {
      name: 'returns a failure without retrying the script',
      check: async () => {
        const staged = await harness.stage({
          kind: 'failsThenSucceeds',
          failure,
        });
        const {outcome} = await runCollecting(staged, new AbortController());
        deepStrictEqual(failureKindOf(outcome), `failed:${failure}`);
      },
    },
  ];
}

function scriptCases(harness: ChannelHarness): ContractCase[] {
  return [
    {
      name: 'delivers every output line in order before the outcome',
      check: async () => {
        const staged = await harness.stage({
          kind: 'printsLines',
          lines: PRINTED_LINES,
          status: 0,
        });
        deepStrictEqual(await runCollecting(staged, new AbortController()), {
          lines: PRINTED_LINES,
          outcome: {kind: 'exited', status: 0},
        });
      },
    },
    {
      name: 'reports a non-zero exit status as a result, not a failure',
      check: async () => {
        const staged = await harness.stage({
          kind: 'printsLines',
          lines: [],
          status: 3,
        });
        deepStrictEqual(
          (await runCollecting(staged, new AbortController())).outcome,
          {kind: 'exited', status: 3},
        );
      },
    },
    {
      name: 'ends a script cancelled before the call as cancelled, with no output',
      check: async () => {
        const staged = await harness.stage({
          kind: 'printsLines',
          lines: PRINTED_LINES,
          status: 0,
        });
        const controller = new AbortController();
        controller.abort();
        const {lines, outcome} = await runCollecting(staged, controller);
        deepStrictEqual(
          [lines, failureKindOf(outcome)],
          [[], 'failed:cancelled'],
        );
      },
    },
    {
      name: 'ends a running script as cancelled when it is cancelled',
      check: () =>
        cancelsOnFirstLine(harness, {
          kind: 'printsUntilCancelled',
          lines: ['started'],
        }),
    },
    ...harness.scriptFailures.map(failure => ({
      name: `maps a script failure to ${failure} and keeps the transport's message`,
      check: async () => {
        const staged = await harness.stage({kind: 'scriptFails', failure});
        const {outcome} = await runCollecting(staged, new AbortController());
        deepStrictEqual(failureKindOf(outcome), `failed:${failure}`);
      },
    })),
  ];
}

function inputCases(harness: ChannelHarness): ContractCase[] {
  return [
    {
      name: "streams a local file to the script's input byte for byte",
      check: async () => {
        const staged = await harness.stage({
          kind: 'digestsInput',
          input: {kind: 'file', content: STREAMED_CONTENT},
        });
        deepStrictEqual(await runCollecting(staged, new AbortController()), {
          lines: [digestOf(STREAMED_CONTENT)],
          outcome: {kind: 'exited', status: 0},
        });
      },
    },
    {
      name: "gives a text input to the script's input as UTF-8",
      check: async () => {
        const staged = await harness.stage({
          kind: 'digestsInput',
          input: {kind: 'text', text: TEXT_INPUT},
        });
        deepStrictEqual(await runCollecting(staged, new AbortController()), {
          lines: [digestOf(TEXT_INPUT)],
          outcome: {kind: 'exited', status: 0},
        });
      },
    },
    {
      name: 'fails a run whose input file is missing with spawnFailed naming the file, with no output',
      check: async () => {
        const staged = await harness.stage({kind: 'missingInputFile'});
        const {lines, outcome} = await runCollecting(
          staged,
          new AbortController(),
        );
        const {input} = staged.script;
        const namesFile =
          outcome.kind === 'failed' &&
          input.kind === 'file' &&
          outcome.failure.detail.includes(input.localFile);
        deepStrictEqual(
          [lines, failureKindOf(outcome), namesFile],
          [[], 'failed:spawnFailed', true],
        );
      },
    },
    {
      name: 'ends a script reading a streamed file as cancelled when it is cancelled',
      check: () =>
        cancelsOnFirstLine(harness, {
          kind: 'streamsUntilCancelled',
          lines: ['streaming'],
        }),
    },
  ];
}

function clientPathCases(harness: ChannelHarness): ContractCase[] {
  const reachabilities = harness.reachesClientFiles ? [false, true] : [false];
  return reachabilities.map(reachable => ({
    name: reachable
      ? 'gives the host path of a client file the host reads directly'
      : 'gives no host path for a client file the host cannot read directly',
    check: async () => {
      const staged = await harness.stage({kind: 'clientFile', reachable});
      deepStrictEqual(
        await hostPathOf(staged.channel, staged.copy.localFile),
        staged.hostPath,
      );
    },
  }));
}

function copyCases(harness: ChannelHarness): ContractCase[] {
  async function copyOutcome(
    scenario: ContractScenario,
    controller: AbortController,
  ): Promise<CopyOutcome> {
    const staged = await harness.stage(scenario);
    return staged.channel.copyToHost({
      ...staged.copy,
      cancellation: controller.signal,
    });
  }
  return [
    {
      name: 'copies a file',
      check: async () => {
        deepStrictEqual(
          await copyOutcome({kind: 'copies'}, new AbortController()),
          {kind: 'copied'},
        );
      },
    },
    {
      name: 'ends a copy cancelled before the call as cancelled',
      check: async () => {
        const controller = new AbortController();
        controller.abort();
        deepStrictEqual(
          failureKindOf(await copyOutcome({kind: 'copies'}, controller)),
          'failed:cancelled',
        );
      },
    },
    ...harness.copyFailures.map(failure => ({
      name: `maps a copy failure to ${failure} and keeps the transport's message`,
      check: async () => {
        deepStrictEqual(
          failureKindOf(
            await copyOutcome(
              {kind: 'copyFails', failure},
              new AbortController(),
            ),
          ),
          `failed:${failure}`,
        );
      },
    })),
  ];
}

/** The contract's cases for one implementation, staged through its harness. */
export function channelContractCases(harness: ChannelHarness): ContractCase[] {
  return [
    ...scriptCases(harness),
    ...retryCases(harness),
    ...inputCases(harness),
    ...copyCases(harness),
    ...clientPathCases(harness),
  ];
}
