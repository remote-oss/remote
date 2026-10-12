import {deepStrictEqual, throws} from 'node:assert';
import {
  preludeProgram,
  sessionStart,
  sessionStartFor,
} from '../../src/index.ts';
import {planScript} from '../../src/process/remote-program.ts';

describe('the session start (card ssh-34, #443)', () => {
  it('#443: the prelude starts with the bound and ends with exec sh', () => {
    const {prelude} = sessionStart(15);
    deepStrictEqual(
      [
        prelude.startsWith('LAYER1_SECONDS=15\n'),
        prelude.endsWith('exec sh\n'),
      ],
      [true, true],
    );
  });

  it('#443: the remote program reads the prelude by its UTF-8 byte length', () => {
    const {prelude, remoteProgram} = sessionStart(15);
    deepStrictEqual(
      remoteProgram,
      `sh -c 'eval "$(dd bs=1 count=${String(Buffer.byteLength(prelude, 'utf8'))} 2>/dev/null)"'`,
    );
  });

  it('#443: a bound of 0 is a RangeError', () => {
    throws(() => sessionStart(0), RangeError);
  });

  it('#443: a bound of 601 is a RangeError', () => {
    throws(() => sessionStart(601), RangeError);
  });

  it('#443: a bound of 1.5 is a RangeError', () => {
    throws(() => sessionStart(1.5), RangeError);
  });

  it('#443: the bounds 1 and 600 are accepted', () => {
    deepStrictEqual(
      [sessionStart(1).prelude, sessionStart(600).prelude].map(
        prelude => prelude.split('\n')[0],
      ),
      ['LAYER1_SECONDS=1', 'LAYER1_SECONDS=600'],
    );
  });

  it('§S10: the remote program holds exactly two single quotes and no newline', () => {
    const {remoteProgram} = sessionStart(15);
    deepStrictEqual(
      [remoteProgram.split("'").length - 1, remoteProgram.includes('\n')],
      [2, false],
    );
  });

  it('#443: planScript with an input and an environment uses the same form', () => {
    const plan = planScript({
      script: 'cat',
      interpreter: 'posixShell',
      environment: {NAME: 'x'},
      input: {kind: 'text', text: 'data'},
    });
    deepStrictEqual(
      plan.kind === 'planned' ? plan.remoteProgram : plan.reason,
      preludeProgram(Buffer.byteLength("NAME='x'\nexport NAME\ncat\n", 'utf8')),
    );
  });

  it('#443: a wait of 20 s is a bound of 20', () => {
    deepStrictEqual(
      sessionStartFor({
        connectTimeoutSeconds: 20,
        fromHost: false,
        unboundedWaitSeconds: 600,
      }),
      sessionStart(20),
    );
  });

  it("#443: a host's own 0 takes the unbounded wait", () => {
    deepStrictEqual(
      sessionStartFor({
        connectTimeoutSeconds: 0,
        fromHost: true,
        unboundedWaitSeconds: 600,
      }),
      sessionStart(600),
    );
  });

  it("#443: the setting's 0 is the shortest bound, 1", () => {
    deepStrictEqual(
      sessionStartFor({
        connectTimeoutSeconds: 0,
        fromHost: false,
        unboundedWaitSeconds: 600,
      }),
      sessionStart(1),
    );
  });

  it('#443: a wait of 7.5 s rounds up to 8', () => {
    deepStrictEqual(
      sessionStartFor({
        connectTimeoutSeconds: 7.5,
        fromHost: false,
        unboundedWaitSeconds: 600,
      }),
      sessionStart(8),
    );
  });

  it('#443: a wait past the ceiling is the ceiling', () => {
    deepStrictEqual(
      sessionStartFor({
        connectTimeoutSeconds: 5000,
        fromHost: false,
        unboundedWaitSeconds: 600,
      }),
      sessionStart(600),
    );
  });
});
