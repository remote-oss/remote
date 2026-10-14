import {deepStrictEqual, strictEqual, throws} from 'node:assert';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  type CopyOutcome,
  type CopyRequest,
  hostPathOf,
  posixQuote,
  type ScriptOutcome,
  type ScriptRequest,
} from 'lib-host';
import {
  LineSplitter,
  nodeLocalFiles,
  planScript,
  type ProcessSpecification,
  SshHostChannel,
} from '../../src/index.ts';
import {
  environmentPrefix,
  scriptText,
} from '../../src/process/remote-program.ts';
import {
  type ClientScript,
  FakeClientProcess,
  ScriptedSpawner,
  startError,
} from './fake-client-process.ts';
import {
  asyncPieces,
  channelBase,
  failingPieces,
} from './host-channel-fixture.ts';

function request(overrides: Partial<ScriptRequest> = {}): ScriptRequest {
  return {
    script: 'echo hi',
    interpreter: 'posixShell',
    environment: {},
    input: {kind: 'text', text: ''},
    cancellation: new AbortController().signal,
    ...overrides,
  };
}

/** A client that prints `output` and ends with `status`. */
function prints(output: string, status: number): ClientScript {
  return process => {
    process.output(output);
    process.exit(status);
  };
}

describe('SSH host channel', () => {
  describe('identity', () => {
    it('is the host string as written, with the platform it was given and no direct client path', async () => {
      const channel = new SshHostChannel(channelBase());
      deepStrictEqual(
        [
          channel.identity(),
          channel.platformHint(),
          await hostPathOf(channel, '/x'),
        ],
        ['user@host.invalid:22', 'linux', undefined],
      );
    });
  });

  describe('construction', () => {
    for (const timeoutMilliseconds of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      it(`refuses a timeout of ${String(timeoutMilliseconds)} ms`, () => {
        throws(
          () => new SshHostChannel({...channelBase(), timeoutMilliseconds}),
          RangeError,
        );
      });
    }

    it('accepts a positive timeout and none at all', () => {
      new SshHostChannel({...channelBase(), timeoutMilliseconds: 1});
      new SshHostChannel(channelBase());
    });
  });

  describe('the remote command', () => {
    it('quotes a value as one word, a single quote included', () => {
      strictEqual(posixQuote("it's"), `'it'\\''s'`);
    });

    it('sends a script without input on the input of sh -s', () => {
      deepStrictEqual(planScript(request({script: 'echo hi'})), {
        kind: 'planned',
        remoteProgram: 'sh -s',
        input: {kind: 'text', text: 'echo hi'},
      });
    });

    it('sets the added environment variables before the script on the input of sh -s, each quoted and exported', () => {
      deepStrictEqual(
        planScript(
          request({environment: {GREETING: "it's"}, script: 'echo $GREETING'}),
        ),
        {
          kind: 'planned',
          remoteProgram: 'sh -s',
          input: {
            kind: 'text',
            text: "GREETING='it'\\''s'\nexport GREETING\necho $GREETING",
          },
        },
      );
    });

    it('§S10: with input and an environment, the prelude leads the input and only its byte count is on the command line', () => {
      const prelude = "FIRST='é'\nexport FIRST\ncat\n";
      deepStrictEqual(
        planScript(
          request({
            environment: {FIRST: 'é'},
            script: 'cat',
            input: {kind: 'text', text: 'data'},
          }),
        ),
        {
          kind: 'planned',
          remoteProgram: `sh -c 'eval "$(dd bs=1 count=${String(Buffer.byteLength(prelude))} 2>/dev/null)"'`,
          input: {kind: 'text', text: `${prelude}data`},
        },
      );
    });

    it('§S10: with a streamed file and an environment, the prelude is the prefix of the file', () => {
      deepStrictEqual(
        planScript(
          request({
            environment: {FIRST: 'x'},
            script: 'cat',
            input: {kind: 'file', localFile: '/a'},
          }),
        ),
        {
          kind: 'planned',
          remoteProgram: `sh -c 'eval "$(dd bs=1 count=27 2>/dev/null)"'`,
          input: {
            kind: 'prefixedFile',
            prefix: "FIRST='x'\nexport FIRST\ncat\n",
            localFile: '/a',
          },
        },
      );
    });

    it('§S10: environmentPrefix quotes each value in order and is empty for none', () => {
      deepStrictEqual(
        [
          environmentPrefix({FIRST: 'x y', SECOND: "it's"}),
          environmentPrefix({}),
        ],
        ["FIRST='x y' SECOND='it'\\''s' ", ''],
      );
    });

    it('§S10: the script text has no assignment lines', () => {
      deepStrictEqual(
        scriptText({
          script: 'echo hi',
          interpreter: 'posixShell',
          environment: {FIRST: 'secret'},
        }),
        {kind: 'text', text: 'echo hi'},
      );
    });

    it('sends a script with text input as the one quoted argument of sh -c, the input on the input', () => {
      deepStrictEqual(
        planScript(
          request({script: 'cat', input: {kind: 'text', text: 'data'}}),
        ),
        {
          kind: 'planned',
          remoteProgram: `sh -c 'eval "$(dd bs=1 count=4 2>/dev/null)"'`,
          input: {kind: 'text', text: 'cat\ndata'},
        },
      );
    });

    it('does the same for a streamed file', () => {
      deepStrictEqual(
        planScript(
          request({script: 'cat', input: {kind: 'file', localFile: '/a'}}),
        ),
        {
          kind: 'planned',
          remoteProgram: `sh -c 'eval "$(dd bs=1 count=4 2>/dev/null)"'`,
          input: {kind: 'prefixedFile', prefix: 'cat\n', localFile: '/a'},
        },
      );
    });

    it('#443: with input and no environment, the remote command is the fixed reader of the prelude', () => {
      const plan = planScript(
        request({script: 'cat', input: {kind: 'text', text: 'abc'}}),
      );
      strictEqual(
        plan.kind === 'planned' ? plan.remoteProgram : plan.reason,
        `sh -c 'eval "$(dd bs=1 count=4 2>/dev/null)"'`,
      );
    });

    it('#443: with input and no environment, the prelude leads the text on the input', () => {
      const plan = planScript(
        request({script: 'cat', input: {kind: 'text', text: 'abc'}}),
      );
      deepStrictEqual(plan.kind === 'planned' ? plan.input : plan.kind, {
        kind: 'text',
        text: 'cat\nabc',
      });
    });

    it('#443: with a streamed file and no environment, the prelude is the prefix of the file', () => {
      const plan = planScript(
        request({script: 'cat', input: {kind: 'file', localFile: '/f'}}),
      );
      deepStrictEqual(plan.kind === 'planned' ? plan.input : plan.kind, {
        kind: 'prefixedFile',
        prefix: 'cat\n',
        localFile: '/f',
      });
    });

    it('#443: no combination of input and environment puts a newline or ! in the remote command', () => {
      const runs = [
        planScript(request({script: 'cat'})),
        planScript(request({environment: {FIRST: 'x'}, script: 'cat'})),
        planScript(request({script: 'cat', input: {kind: 'text', text: 'a'}})),
        planScript(
          request({
            environment: {FIRST: 'x'},
            script: 'cat',
            input: {kind: 'text', text: 'a'},
          }),
        ),
        planScript(
          request({script: 'cat', input: {kind: 'file', localFile: '/f'}}),
        ),
        planScript(
          request({
            environment: {FIRST: 'x'},
            script: 'cat',
            input: {kind: 'file', localFile: '/f'},
          }),
        ),
      ];
      deepStrictEqual(
        runs.map(plan =>
          plan.kind === 'planned'
            ? plan.remoteProgram.includes('\n') ||
              plan.remoteProgram.includes('!')
            : true,
        ),
        [false, false, false, false, false, false],
      );
    });

    it('refuses an interpreter other than the POSIX shell', () => {
      deepStrictEqual(planScript(request({interpreter: 'powershell'})), {
        kind: 'refused',
        reason: 'the powershell interpreter is not available over SSH yet',
      });
    });

    it('refuses an environment name a variable cannot have', () => {
      deepStrictEqual(planScript(request({environment: {'A B': 'x'}})), {
        kind: 'refused',
        reason: "'A B' is not a name an environment variable can have",
      });
    });
  });

  describe('runScript', () => {
    it('starts ssh once with the remote command as its last argument and sends the script on its input', async () => {
      const spawner = new ScriptedSpawner(prints('', 0));
      const channel = new SshHostChannel({
        ...channelBase(),
        spawner: spawner.spawn,
      });
      await channel.runScript(request({script: 'echo hi'}), () => undefined);
      const started = spawner.started[0];
      deepStrictEqual(
        [
          spawner.started.length,
          started?.specification.program,
          started?.specification.programArguments.at(-1),
          started?.inputText(),
          started?.inputEnded,
        ],
        [1, '/usr/bin/ssh', 'sh -s', 'echo hi', true],
      );
    });

    it('passes the editor environment to the client', async () => {
      const spawner = new ScriptedSpawner(prints('', 0));
      await new SshHostChannel({
        ...channelBase(),
        spawner: spawner.spawn,
      }).runScript(request(), () => undefined);
      strictEqual(
        spawner.started[0]?.specification.environment.PATH,
        '/usr/bin',
      );
    });

    it('fails as spawnFailed, without starting anything, for an interpreter it cannot run', async () => {
      const spawner = new ScriptedSpawner(prints('', 0));
      const outcome = await new SshHostChannel({
        ...channelBase(),
        spawner: spawner.spawn,
      }).runScript(request({interpreter: 'powershell'}), () => undefined);
      deepStrictEqual(
        [outcome, spawner.started.length],
        [
          {
            kind: 'failed',
            failure: {
              kind: 'spawnFailed',
              detail:
                'the powershell interpreter is not available over SSH yet',
            },
          },
          0,
        ],
      );
    });

    it('delivers a last line that has no line end, and strips a carriage return', async () => {
      const spawner = new ScriptedSpawner(prints('one\r\ntwo', 0));
      const lines: string[] = [];
      await new SshHostChannel({
        ...channelBase(),
        spawner: spawner.spawn,
      }).runScript(request(), line => lines.push(line));
      deepStrictEqual(lines, ['one', 'two']);
    });

    it('reports the exit status of the script as a result', async () => {
      const spawner = new ScriptedSpawner(prints('', 7));
      deepStrictEqual(
        await new SshHostChannel({
          ...channelBase(),
          spawner: spawner.spawn,
        }).runScript(request(), () => undefined),
        {kind: 'exited', status: 7},
      );
    });

    it('maps status 255 to channelClosed with the end of the client error', async () => {
      const spawner = new ScriptedSpawner(process => {
        process.error('debug1: ...\nConnection reset by peer\n');
        process.exit(255);
      });
      deepStrictEqual(
        await new SshHostChannel({
          ...channelBase(),
          spawner: spawner.spawn,
        }).runScript(request(), () => undefined),
        {
          kind: 'failed',
          failure: {
            kind: 'channelClosed',
            detail:
              'ssh could not keep the connection: Connection reset by peer',
          },
        },
      );
    });

    it('maps an end by a signal to channelClosed', async () => {
      const spawner = new ScriptedSpawner(process => {
        process.exit(undefined);
      });
      const outcome = await new SshHostChannel({
        ...channelBase(),
        spawner: spawner.spawn,
      }).runScript(request(), () => undefined);
      deepStrictEqual(outcome.kind === 'failed' ? outcome.failure : outcome, {
        kind: 'channelClosed',
        detail: 'ssh ended by a signal',
      });
    });

    it('keeps only the end of a long client error', async () => {
      const spawner = new ScriptedSpawner(process => {
        process.error(`${'x'.repeat(5000)}END`);
        process.exit(255);
      });
      const outcome = await new SshHostChannel({
        ...channelBase(),
        spawner: spawner.spawn,
      }).runScript(request(), () => undefined);
      const detail = outcome.kind === 'failed' ? outcome.failure.detail : '';
      deepStrictEqual(
        [detail.length < 2100, detail.endsWith('END')],
        [true, true],
      );
    });

    it('maps a failed start to spawnFailed with the system message', async () => {
      const spawner = new ScriptedSpawner(
        startError('ENOENT', 'spawn ssh ENOENT'),
      );
      const outcome = await new SshHostChannel({
        ...channelBase(),
        spawner: spawner.spawn,
      }).runScript(request(), () => undefined);
      deepStrictEqual(outcome, {
        kind: 'failed',
        failure: {kind: 'spawnFailed', detail: 'spawn ssh ENOENT'},
      });
    });

    it('kills the client when cancelled, and delivers no line after the outcome', async () => {
      const spawner = new ScriptedSpawner(process => {
        process.output('first\n');
      });
      const controller = new AbortController();
      const lines: string[] = [];
      const channel = new SshHostChannel({
        ...channelBase(),
        spawner: spawner.spawn,
      });
      const outcome = await channel.runScript(
        request({cancellation: controller.signal}),
        line => {
          lines.push(line);
          controller.abort();
          spawner.started[0]?.output('late\n');
        },
      );
      deepStrictEqual(
        [outcome.kind, lines, spawner.started[0]?.killed],
        ['failed', ['first'], true],
      );
    });

    it('S10: a cancellation that lands before the run is watched is cancelled', async () => {
      const controller = new AbortController();
      const started: FakeClientProcess[] = [];
      function spawner(specification: ProcessSpecification) {
        const fake = new FakeClientProcess(specification);
        started.push(fake);
        controller.abort();
        return Promise.resolve(fake);
      }
      const outcome = await new SshHostChannel({
        ...channelBase(),
        spawner,
      }).runScript(
        {...request(), cancellation: controller.signal},
        () => undefined,
      );
      deepStrictEqual(
        [
          outcome.kind === 'failed' ? outcome.failure : outcome,
          started[0]?.killed,
        ],
        [{kind: 'cancelled', detail: 'cancelled by the caller'}, true],
      );
    });

    it('kills the client and reports timeout when its time runs out', async () => {
      const spawner = new ScriptedSpawner(() => undefined);
      const outcome = await new SshHostChannel({
        ...channelBase(),
        spawner: spawner.spawn,
        timeoutMilliseconds: 5000,
        scheduler: {
          setTimer: (milliseconds, callback) => {
            const handle = setImmediate(callback);
            return () => {
              clearImmediate(handle);
            };
          },
        },
      }).runScript(request(), () => undefined);
      deepStrictEqual(
        [
          outcome.kind === 'failed' ? outcome.failure : outcome,
          spawner.started[0]?.killed,
        ],
        [{kind: 'timeout', detail: 'no end within 5000 ms'}, true],
      );
    });

    /** Runs a script whose input is a file read as `pieces`, against a client that ends when its input does. */
    async function runWithFile(pieces: AsyncIterable<Uint8Array>): Promise<{
      outcome: ScriptOutcome;
      spawner: ScriptedSpawner;
    }> {
      const spawner = new ScriptedSpawner(process => {
        process.whenInputEnds(() => {
          process.exit(0);
        });
      });
      const channel = new SshHostChannel({
        ...channelBase(),
        spawner: spawner.spawn,
        files: {exists: () => Promise.resolve(true), read: () => pieces},
      });
      const outcome = await channel.runScript(
        request({input: {kind: 'file', localFile: '/f'}}),
        () => undefined,
      );
      return {outcome, spawner};
    }

    it('streams a file to the input in the pieces it comes in, then closes the input', async () => {
      const {spawner} = await runWithFile(
        asyncPieces([Uint8Array.of(1, 2), Uint8Array.of(3)]),
      );
      deepStrictEqual(
        spawner.started[0]?.input.map(piece => [...piece]),
        [[...Buffer.from('echo hi\n', 'utf8')], [1, 2], [3]],
      );
    });

    it('ends the input early, without failing the run, when the file cannot be read', async () => {
      deepStrictEqual((await runWithFile(failingPieces())).outcome, {
        kind: 'exited',
        status: 0,
      });
    });
  });

  describe('copyToHost', () => {
    function copyRequest(): CopyRequest {
      return {
        localFile: '/local/a.tar.gz',
        remotePath: '/home/user/a.tar.gz',
        cancellation: new AbortController().signal,
      };
    }

    it('starts scp once with the file and the host path and closes its input', async () => {
      const spawner = new ScriptedSpawner(prints('', 0));
      const outcome = await new SshHostChannel({
        ...channelBase(),
        spawner: spawner.spawn,
      }).copyToHost(copyRequest());
      const started = spawner.started[0];
      deepStrictEqual(
        [
          outcome,
          spawner.started.length,
          started?.specification.program,
          started?.specification.programArguments.includes('/local/a.tar.gz'),
          started?.inputEnded,
        ],
        [{kind: 'copied'}, 1, '/usr/bin/scp', true, true],
      );
    });

    /** The outcome of one copy by a client that follows `script`, or whose start fails with it. */
    function copyBy(script: ClientScript | Error): Promise<CopyOutcome> {
      return new SshHostChannel({
        ...channelBase(),
        spawner: new ScriptedSpawner(script).spawn,
      }).copyToHost(copyRequest());
    }

    it('maps a missing scp to copyToolMissing', async () => {
      deepStrictEqual(await copyBy(startError('ENOENT', 'spawn scp ENOENT')), {
        kind: 'failed',
        failure: {kind: 'copyToolMissing', detail: 'spawn scp ENOENT'},
      });
    });

    it('maps any other failed start to copyFailed', async () => {
      deepStrictEqual(
        await copyBy(startError('EMFILE', 'too many open files')),
        {
          kind: 'failed',
          failure: {kind: 'copyFailed', detail: 'too many open files'},
        },
      );
    });

    it("maps a failed copy to copyFailed with scp's message", async () => {
      deepStrictEqual(
        await copyBy(process => {
          process.error('scp: /remote: Permission denied\n');
          process.exit(1);
        }),
        {
          kind: 'failed',
          failure: {
            kind: 'copyFailed',
            detail: 'scp failed: scp: /remote: Permission denied',
          },
        },
      );
    });

    it('#402: a failed copy keeps its error lines when the debug lines would push them out', async () => {
      deepStrictEqual(
        await copyBy(process => {
          process.error(
            `${Array.from({length: 70}, () => `debug1: ${'x'.repeat(32)}`).join('\n')}\n`,
          );
          process.error('scp: dest open "/x/f": No such file or directory\n');
          process.error(
            'Transferred: sent 1, received 2 bytes, in 0.1 seconds\n',
          );
          process.exit(1);
        }),
        {
          kind: 'failed',
          failure: {
            kind: 'copyFailed',
            detail:
              'scp failed: scp: dest open "/x/f": No such file or directory\nTransferred: sent 1, received 2 bytes, in 0.1 seconds',
          },
        },
      );
    });

    it('#402: a debug line of the client itself is left out of the detail', async () => {
      deepStrictEqual(
        await copyBy(process => {
          process.error(
            'scp: debug1: stat remote: No such file or directory\nscp: failed to upload file f to /x/f\n',
          );
          process.exit(1);
        }),
        {
          kind: 'failed',
          failure: {
            kind: 'copyFailed',
            detail: 'scp failed: scp: failed to upload file f to /x/f',
          },
        },
      );
    });

    it('#402: an error line split over pieces of the error arrives whole', async () => {
      deepStrictEqual(
        await copyBy(process => {
          process.error('scp: dest op');
          process.error('en "/x/f": No such file\n');
          process.exit(1);
        }),
        {
          kind: 'failed',
          failure: {
            kind: 'copyFailed',
            detail: 'scp failed: scp: dest open "/x/f": No such file',
          },
        },
      );
    });

    it('#402: a last error line without a line end is kept', async () => {
      deepStrictEqual(
        await copyBy(process => {
          process.error('scp: /remote: Permission denied');
          process.exit(1);
        }),
        {
          kind: 'failed',
          failure: {
            kind: 'copyFailed',
            detail: 'scp failed: scp: /remote: Permission denied',
          },
        },
      );
    });

    it('#402: a copy whose error holds debug lines only keeps no detail', async () => {
      deepStrictEqual(
        await copyBy(process => {
          process.error('debug1: x\n');
          process.exit(1);
        }),
        {
          kind: 'failed',
          failure: {kind: 'copyFailed', detail: 'scp failed'},
        },
      );
    });

    it('S10: the detail keeps the last 2000 characters of the kept error lines', async () => {
      const lines: string[] = [];
      for (let index = 0; index < 30; index += 1) {
        lines.push(`${String(index).padStart(2, '0')}: ${'y'.repeat(96)}`);
      }
      const joined = lines.join('\n');
      deepStrictEqual(
        await copyBy(process => {
          process.error(`${joined}\n`);
          process.exit(1);
        }),
        {
          kind: 'failed',
          failure: {
            kind: 'copyFailed',
            detail: `scp failed: ${joined.slice(-2000)}`,
          },
        },
      );
    });

    it('#417 (1): a failed copy keeps its last 50 error lines, the oldest dropped', async () => {
      const lines: string[] = [];
      for (let index = 0; index < 60; index += 1) {
        lines.push(`e${String(index + 1)}`);
      }
      const outcome = await copyBy(process => {
        process.error(`${lines.join('\n')}\n`);
        process.exit(1);
      });
      deepStrictEqual(
        outcome.kind === 'failed' ? outcome.failure.detail : outcome,
        `scp failed: ${lines.slice(10).join('\n')}`,
      );
    });

    it('#417 (1): a cause followed by ten thousand debug lines is still told', async () => {
      const outcome = await copyBy(process => {
        process.error('scp: dest open "/x/f": No such file\n');
        process.error(
          Array.from(
            {length: 10_000},
            (unusedItem, index) => `debug1: ${String(index)}\n`,
          ).join(''),
        );
        process.exit(1);
      });
      deepStrictEqual(
        outcome.kind === 'failed' ? outcome.failure.detail : outcome,
        'scp failed: scp: dest open "/x/f": No such file',
      );
    });

    it('F-2109 BR-4: a debug2 line of the client stays in the detail, as in the log', async () => {
      const outcome = await copyBy(process => {
        process.error('debug2: forced\nscp: failed to upload\n');
        process.exit(1);
      });
      deepStrictEqual(
        outcome.kind === 'failed' ? outcome.failure.detail : outcome,
        'scp failed: debug2: forced\nscp: failed to upload',
      );
    });
    it('#434: a blank line between two error lines is not kept in the detail', async () => {
      const outcome = await copyBy(process => {
        process.error(
          'scp: /x: No such file or directory\n\nscp: /y: Permission denied\n',
        );
        process.exit(1);
      });
      deepStrictEqual(
        outcome.kind === 'failed' ? outcome.failure.detail : outcome,
        'scp failed: scp: /x: No such file or directory\nscp: /y: Permission denied',
      );
    });

    it('maps status 255 to channelClosed', async () => {
      deepStrictEqual(
        await copyBy(process => {
          process.exit(255);
        }),
        {
          kind: 'failed',
          failure: {
            kind: 'channelClosed',
            detail: 'scp could not keep the connection',
          },
        },
      );
    });

    it('kills scp when cancelled', async () => {
      const spawner = new ScriptedSpawner(() => undefined);
      const controller = new AbortController();
      const pending = new SshHostChannel({
        ...channelBase(),
        spawner: spawner.spawn,
      }).copyToHost({...copyRequest(), cancellation: controller.signal});
      await new Promise(resolve => {
        setImmediate(resolve);
      });
      controller.abort();
      const outcome = await pending;
      deepStrictEqual(
        [
          outcome.kind === 'failed' ? outcome.failure.kind : outcome,
          spawner.started[0]?.killed,
        ],
        ['cancelled', true],
      );
    });

    describe('with a copier', () => {
      it('#253 Q11: asks the copier and starts no process', async () => {
        const spawner = new ScriptedSpawner(prints('', 0));
        const asked: CopyRequest[] = [];
        const request = copyRequest();
        const outcome = await new SshHostChannel({
          ...channelBase(),
          spawner: spawner.spawn,
          copier: asking => {
            asked.push(asking);
            return Promise.resolve<CopyOutcome>({kind: 'copied'});
          },
        }).copyToHost(request);
        deepStrictEqual(
          [outcome, asked, spawner.started.length],
          [{kind: 'copied'}, [request], 0],
        );
      });

      it('#253 Q11: a cancellation that came before the copy does not reach the copier', async () => {
        const controller = new AbortController();
        controller.abort();
        let asked = 0;
        const outcome = await new SshHostChannel({
          ...channelBase(),
          copier: () => {
            asked += 1;
            return Promise.resolve<CopyOutcome>({kind: 'copied'});
          },
        }).copyToHost({...copyRequest(), cancellation: controller.signal});
        deepStrictEqual(
          [outcome.kind === 'failed' ? outcome.failure.kind : outcome, asked],
          ['cancelled', 0],
        );
      });

      it('#253 Q11: what the copier answers is the outcome', async () => {
        const failed: CopyOutcome = {
          kind: 'failed',
          failure: {kind: 'copyFailed', detail: 'scp failed: no space'},
        };
        deepStrictEqual(
          await new SshHostChannel({
            ...channelBase(),
            copier: () => Promise.resolve(failed),
          }).copyToHost(copyRequest()),
          failed,
        );
      });
    });
  });
});

describe('LineSplitter', () => {
  it('joins a line that arrives in pieces and delivers whole lines in order', () => {
    const lines: string[] = [];
    const splitter = new LineSplitter(line => lines.push(line));
    splitter.push('ab');
    splitter.push('c\nde');
    splitter.push('f\n\ng');
    deepStrictEqual(lines, ['abc', 'def', '']);
  });

  it('keeps nothing back when the stream ended on a line end', () => {
    const lines: string[] = [];
    const splitter = new LineSplitter(line => lines.push(line));
    splitter.push('a\n');
    splitter.flush();
    deepStrictEqual(lines, ['a']);
  });
});

describe('local files on Node.js', () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'local-files-'));
  });

  afterEach(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  it('knows a file, and neither a folder nor a path that is not there', async () => {
    const file = path.join(folder, 'a.bin');
    writeFileSync(file, 'x');
    deepStrictEqual(
      [
        await nodeLocalFiles.exists(file),
        await nodeLocalFiles.exists(folder),
        await nodeLocalFiles.exists(path.join(folder, 'none')),
      ],
      [true, false, false],
    );
  });

  it('reads a file as its bytes', async () => {
    const file = path.join(folder, 'a.bin');
    writeFileSync(file, Uint8Array.of(0, 255, 10, 13));
    const pieces: number[] = [];
    for await (const piece of nodeLocalFiles.read(file)) {
      pieces.push(...piece);
    }
    deepStrictEqual(pieces, [0, 255, 10, 13]);
  });
});
