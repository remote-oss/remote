import {deepStrictEqual} from 'node:assert';
import {
  createProtocol,
  readHostnames,
  type Timers,
  writeActiveFoldersPush,
  writeEnvelope,
} from '../../src/index.ts';
import {createRecordingFake} from '../../src/testing/recording-fake.ts';

const HOSTS = 'remote-internal.getConfiguredHostnames';
const ACTIVE_FOLDERS = 'remote-internal.setActiveFolders';

/** The result of settling a promise: what it resolved with, or the reason it rejected for. */
async function settled(
  promise: PromiseLike<unknown>,
): Promise<{resolved: unknown} | {rejected: unknown}> {
  try {
    return {resolved: await promise};
  } catch (reason) {
    return {rejected: reason};
  }
}

describe('the recording fake', () => {
  it('F-5902.AC-18: an answer set for an id is resolved itself, and the call is recorded with its version', async () => {
    const fake = createRecordingFake();
    const result = {marker: 'result'};
    const argument = writeEnvelope();
    fake.answerWith(HOSTS, {kind: 'answer', result});
    const outcome = await settled(fake.executeCommand(HOSTS, argument));
    deepStrictEqual(
      [
        'resolved' in outcome && outcome.resolved === result,
        fake.calls,
        fake.calls[0]?.interfaceVersion === argument.interfaceVersion,
        fake.calls[0] !== undefined && 'outcome' in fake.calls[0],
      ],
      [
        true,
        [{commandId: HOSTS, interfaceVersion: {major: 1, minor: 0}}],
        true,
        false,
      ],
    );
  });

  it('F-5902.AC-19: an unanswered, unregistered push is rejected as not found and records its outcome', async () => {
    const fake = createRecordingFake();
    const outcome = await settled(
      fake.executeCommand(
        ACTIVE_FOLDERS,
        writeActiveFoldersPush({outcome: 'connected', hostKey: 'h'}),
      ),
    );
    deepStrictEqual(
      [outcome, fake.calls[0]?.outcome],
      [
        {rejected: new Error(`command '${ACTIVE_FOLDERS}' not found`)},
        'connected',
      ],
    );
  });

  it('F-5902.AC-19: arguments that are not plain objects, or whose outcome is undefined, are recorded as such', async () => {
    const fake = createRecordingFake();
    for (const argument of [undefined, 'text', {outcome: undefined}]) {
      await settled(fake.executeCommand(ACTIVE_FOLDERS, argument));
    }
    deepStrictEqual(fake.calls, [
      {commandId: ACTIVE_FOLDERS, interfaceVersion: undefined},
      {commandId: ACTIVE_FOLDERS, interfaceVersion: undefined},
      {
        commandId: ACTIVE_FOLDERS,
        interfaceVersion: undefined,
        outcome: undefined,
      },
    ]);
  });

  it('F-5902.AC-19: the property outcome is present on the record only when the argument has it', async () => {
    const fake = createRecordingFake();
    await settled(fake.executeCommand(ACTIVE_FOLDERS, {outcome: undefined}));
    await settled(fake.executeCommand(ACTIVE_FOLDERS, undefined));
    deepStrictEqual(
      fake.calls.map(call => 'outcome' in call),
      [true, false],
    );
  });

  for (const reason of [new Error('refused'), 'refused', undefined]) {
    it(`F-5902.AC-5: a rejection answer rejects with ${String(reason)} itself`, async () => {
      const fake = createRecordingFake();
      fake.answerWith(HOSTS, {kind: 'reject', reason});
      deepStrictEqual(
        await settled(fake.executeCommand(HOSTS, writeEnvelope())),
        {rejected: reason},
      );
    });
  }

  it('F-5902.AC-11: the foreign answer is read as foreign', async () => {
    const fake = createRecordingFake();
    fake.answerWith(HOSTS, {kind: 'foreign'});
    const outcome = await settled(fake.executeCommand(HOSTS, writeEnvelope()));
    deepStrictEqual(
      'resolved' in outcome ? readHostnames(outcome.resolved) : undefined,
      {status: 'refused', reason: 'foreign'},
    );
  });

  it('F-5902.AC-11: the newer-major answer is read as an unknown major', async () => {
    const fake = createRecordingFake();
    fake.answerWith(HOSTS, {kind: 'newerMajor'});
    const outcome = await settled(fake.executeCommand(HOSTS, writeEnvelope()));
    deepStrictEqual(
      'resolved' in outcome ? readHostnames(outcome.resolved) : undefined,
      {status: 'refused', reason: 'unknownMajor'},
    );
  });

  it('F-5902.AC-15: a silent answer never settles', async () => {
    const fake = createRecordingFake();
    fake.answerWith(HOSTS, {kind: 'silent'});
    const winner = await Promise.race([
      fake.executeCommand(HOSTS, writeEnvelope()),
      new Promise<string>(resolve => setTimeout(resolve, 20, 'timer')),
    ]);
    deepStrictEqual(winner, 'timer');
  });

  it('F-5902.5.rules: a registered callback gets the argument alone and its value resolves', async () => {
    const fake = createRecordingFake();
    const value = {marker: 'value'};
    const given: unknown[][] = [];
    const argument = {marker: 'argument'};
    fake.registerCommand('x', (...commandArguments) => {
      given.push(commandArguments);
      return value;
    });
    const outcome = await settled(fake.executeCommand('x', argument));
    deepStrictEqual(
      [
        'resolved' in outcome && outcome.resolved === value,
        given.length,
        given[0]?.length,
        given[0]?.[0] === argument,
      ],
      [true, 1, 1, true],
    );
  });

  it('F-5902.5.rules: a registered callback that throws rejects with what it threw', async () => {
    const fake = createRecordingFake();
    const failure = new Error('thrown');
    fake.registerCommand('x', () => {
      throw failure;
    });
    deepStrictEqual(await settled(fake.executeCommand('x', undefined)), {
      rejected: failure,
    });
  });

  it('F-5902.5.rules: a later registration replaces an earlier one, and disposing keeps only the current callback', () => {
    const fake = createRecordingFake();
    function first(): void {
      throw new Error('first');
    }
    function second(): void {
      throw new Error('second');
    }
    const firstRegistration = fake.registerCommand('x', first);
    const secondRegistration = fake.registerCommand('x', second);
    firstRegistration.dispose();
    const afterFirst = fake.registered('x');
    secondRegistration.dispose();
    deepStrictEqual(
      [afterFirst === second, fake.registered('x')],
      [true, undefined],
    );
  });

  it('F-5902.5.rules: an answer set for an id wins over a registered callback', async () => {
    const fake = createRecordingFake();
    const result = {marker: 'answer'};
    let called = 0;
    fake.registerCommand('x', () => {
      called += 1;
    });
    fake.answerWith('x', {kind: 'answer', result});
    const outcome = await settled(fake.executeCommand('x', undefined));
    deepStrictEqual(
      ['resolved' in outcome && outcome.resolved === result, called],
      [true, 0],
    );
  });

  it('F-5902.5.rules: the protocol reads the fake as not registered, unknown major and rejected', async () => {
    const fake = createRecordingFake();
    const timers: Timers = {
      setTimer: () => undefined,
      clearTimer: () => undefined,
    };
    // eslint-disable-next-line id-length -- the protocol's option is named bus
    const protocol = createProtocol({bus: fake, timers});
    fake.answerWith('remote-internal.newer', {kind: 'newerMajor'});
    fake.answerWith('remote-internal.refused', {
      kind: 'reject',
      reason: new Error('no'),
    });
    const causes: unknown[] = [];
    for (const commandId of [
      'remote-internal.unset',
      'remote-internal.newer',
      'remote-internal.refused',
    ]) {
      const outcome = await protocol.call(
        commandId,
        writeEnvelope(),
        readHostnames,
      );
      causes.push(
        outcome.status === 'unavailable' ? outcome.cause : outcome.status,
      );
    }
    deepStrictEqual(causes, ['notRegistered', 'unknownMajor', 'rejected']);
  });
});
