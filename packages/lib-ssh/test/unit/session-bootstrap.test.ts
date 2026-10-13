import {deepStrictEqual, throws} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  bootstrapEventOf,
  bootstrapLogLine,
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

/** A fake login shell: an executable script in a folder of its own, and a folder for the bootstrap's temporary files. */
function shellOf(body: string): {
  shell: string;
  temporary: string;
  remove(): void;
} {
  const folder = mkdtempSync(path.join(tmpdir(), 'bootstrap-'));
  const shell = path.join(folder, 'login-shell');
  const temporary = path.join(folder, 'tmp');
  mkdirSync(temporary);
  writeFileSync(shell, `#!/bin/sh\n${body}\n`, {mode: 0o755});
  return {
    shell,
    temporary,
    remove: () => {
      rmSync(folder, {recursive: true, force: true});
    },
  };
}

/** What the bootstrap printed and how it ended when `sh` ran it with the fake login shell and `input` after it. */
function bootstrapWith(
  body: string,
  seconds: number,
  input = '',
): {output: string; status: number | null; leftover: string[]} {
  const fake = shellOf(body);
  try {
    const result = spawnSync('sh', ['-c', sessionStart(seconds).prelude], {
      encoding: 'utf8',
      input,
      env: {
        PATH: process.env.PATH ?? '',
        SHELL: fake.shell,
        TMPDIR: fake.temporary,
      },
      timeout: 20_000,
    });
    return {
      output: result.stdout,
      status: result.status,
      leftover: readdirSync(fake.temporary),
    };
  } finally {
    fake.remove();
  }
}

describe('the session bootstrap run by sh (card ssh-38, #443)', () => {
  it('F-2704 AC-11: a login shell that outlasts the bound ends the session with one line and the status 124', () => {
    const {output, status} = bootstrapWith('sleep 30', 1);
    deepStrictEqual([output, status], ['LAYER1-TIMEOUT 1\n', 124]);
  });

  it('F-2704 AC-13: a login shell that ends at once without the start line ends the session with one line and the status 1', () => {
    const {output, status} = bootstrapWith('exit 1', 5);
    deepStrictEqual([output, status], ['LAYER1-EXITED 1\n', 1]);
  });

  it("F-2704 AC-13: the line names the login shell's own status", () => {
    deepStrictEqual(bootstrapWith('exit 7', 5).output, 'LAYER1-EXITED 7\n');
  });

  it('#443: a login shell that prints the start line goes on to the commands, with no marker', () => {
    const {output, status} = bootstrapWith('exec sh', 5, 'echo ok\n');
    deepStrictEqual([output, status], ['LAYER1-READY\nok\n', 0]);
  });

  it('#443: with no usable login shell the session still reaches the commands, after the ready line', () => {
    const fake = shellOf('exit 1');
    try {
      const result = spawnSync('sh', ['-c', sessionStart(5).prelude], {
        encoding: 'utf8',
        input: 'echo ok\n',
        env: {PATH: process.env.PATH ?? ''},
        timeout: 20_000,
      });
      deepStrictEqual(
        [result.stdout, result.status],
        ['LAYER1-READY\nok\n', 0],
      );
    } finally {
      fake.remove();
    }
  });

  it('#443: with no temporary folder the session still reaches the commands, after the ready line', () => {
    const fake = shellOf('exit 1');
    try {
      const folder = path.join(path.dirname(fake.shell), 'bin');
      mkdirSync(folder);
      writeFileSync(path.join(folder, 'mktemp'), '#!/bin/sh\nexit 1\n', {
        mode: 0o755,
      });
      symlinkSync('/bin/sh', path.join(folder, 'sh'));
      const result = spawnSync('/bin/sh', ['-c', sessionStart(5).prelude], {
        encoding: 'utf8',
        input: 'echo ok\n',
        env: {PATH: folder, SHELL: fake.shell},
        timeout: 20_000,
      });
      deepStrictEqual(
        [result.stdout, result.status],
        ['LAYER1-READY\nok\n', 0],
      );
    } finally {
      fake.remove();
    }
  });

  it('#443: the temporary folder is gone after the timeout', () => {
    deepStrictEqual(bootstrapWith('sleep 30', 1).leftover, []);
  });

  it('#443: the temporary folder is gone after a login shell that exited', () => {
    deepStrictEqual(bootstrapWith('exit 1', 5).leftover, []);
  });

  it('#443: the temporary folder is gone after the start line', () => {
    deepStrictEqual(bootstrapWith('exec sh', 5, 'true\n').leftover, []);
  });
});

describe('the reader of the bootstrap lines (card ssh-38, #443)', () => {
  it('F-2704 AC-11: LAYER1-TIMEOUT 5 is a timeout of 5 seconds', () => {
    deepStrictEqual(bootstrapEventOf('LAYER1-TIMEOUT 5'), {
      kind: 'timeout',
      seconds: 5,
    });
  });

  it('F-2704 AC-13: LAYER1-EXITED 7 is an exit with status 7', () => {
    deepStrictEqual(bootstrapEventOf('LAYER1-EXITED 7'), {
      kind: 'exited',
      status: 7,
    });
  });

  it('#443: LAYER1-READY is ready', () => {
    deepStrictEqual(bootstrapEventOf('LAYER1-READY'), {kind: 'ready'});
  });

  it('#443: a terminal line end is left out of the line', () => {
    deepStrictEqual(bootstrapEventOf('LAYER1-READY\r'), {kind: 'ready'});
  });

  it("#443: a line that only contains a marker, or has text after it, is a run's output", () => {
    deepStrictEqual(
      [
        bootstrapEventOf('echo LAYER1-READY'),
        bootstrapEventOf('LAYER1-READY now'),
        bootstrapEventOf('LAYER1-TIMEOUT x'),
        bootstrapEventOf(''),
      ],
      [undefined, undefined, undefined, undefined],
    );
  });

  it('F-2704 AC-11: the log line of a timeout names the seconds', () => {
    deepStrictEqual(
      bootstrapLogLine({kind: 'timeout', seconds: 5}),
      'the login shell did not finish its startup within 5 s',
    );
  });

  it('F-2704 AC-25: the log line of an exit names the status', () => {
    deepStrictEqual(
      bootstrapLogLine({kind: 'exited', status: 1}),
      "the SSH session ended before the host reported its platform: the login shell's startup exited with status 1",
    );
  });
});
