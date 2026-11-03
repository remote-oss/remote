import {deepStrictEqual} from 'node:assert';
import {runAskpassProgram} from 'lib-helper';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {FakeEndpointPort} from 'lib-helper/testing/fake-endpoint';
import {openAskpassRelay} from '../../src/volumes/askpass-relay.ts';
import {
  cloneSourceOf,
  type CloneSource,
} from '../../src/volumes/clone-source.ts';
import {classifyClonePrompt} from '../../src/volumes/git-prompts.ts';
import {precheck} from '../../src/volumes/precheck.ts';

const PLACES = {
  endpoint: '/run/askpass.sock',
  runtimeFolder: '/run',
  runtime: '/editor/node',
  program: '/ext/dist/askpass.js',
};

/** The source of `input`, typed. */
function sourceOf(input: string): CloneSource {
  const source = cloneSourceOf(input, 'typed');
  if ('refused' in source) {
    throw new Error(`${input} was refused`);
  }
  return source;
}

/** A relay over fakes: the questions it was asked, the files it wrote, and its answer to each question. */
async function relayScene(answer: (text: string) => string | undefined) {
  const port = new FakeEndpointPort();
  const asked: Array<{surface: string; text: string}> = [];
  const written: string[] = [];
  const relay = await openAskpassRelay({
    port,
    files: {
      writeExecutable: file => {
        written.push(file);
        return Promise.resolve();
      },
    },
    scheduler: new FakeClock().scheduler(),
    places: PLACES,
    newNonce: () => 'nonce-1',
    askUser: question => {
      asked.push(question);
      return Promise.resolve(answer(question.text));
    },
    logLine: () => undefined,
  });
  /** Runs the askpass program as git would, with the relay's variables, and gives what it printed and its status. */
  async function program(question: string) {
    let printed = '';
    const status = await runAskpassProgram({
      programArguments: [question],
      environment: relay.environment,
      port,
      output: text => {
        printed += text;
      },
    });
    return {printed, status};
  }
  return {relay, asked, written, program, port};
}

describe('the questions of a clone’s check (card containers-151)', () => {
  it('git’s user name is plain, its password and ssh’s passphrase are masked, and an unknown host key is a pick', () => {
    deepStrictEqual(
      [
        "Username for 'https://h.invalid': ",
        "Password for 'https://u@h.invalid': ",
        "Enter passphrase for key '/home/u/.ssh/id_ed25519': ",
        'Are you sure you want to continue connecting (yes/no/[fingerprint])? ',
        'something else',
      ].map(classifyClonePrompt),
      [
        'plainInput',
        'maskedInput',
        'maskedInput',
        'hostKeyPick',
        'maskedInput',
      ],
    );
  });
});

describe('the askpass relay of a clone’s check (card containers-151)', () => {
  it('git and ssh are pointed at the launcher, ssh is forced to use it, and the launcher is written once', async () => {
    const {relay, written} = await relayScene(() => 'x');
    const launcher = written[0];
    deepStrictEqual(
      [
        written.length,
        relay.environment.GIT_ASKPASS,
        relay.environment.SSH_ASKPASS,
        relay.environment.SSH_ASKPASS_REQUIRE,
      ],
      [1, launcher, launcher, 'force'],
    );
    await relay.close();
  });

  it('a question reaches the user as its kind, and the answer reaches the program', async () => {
    const {relay, asked, program} = await relayScene(text =>
      text.startsWith('Username') ? 'alex' : 'secret',
    );
    const user = await program("Username for 'https://h.invalid': ");
    const password = await program("Password for 'https://alex@h.invalid': ");
    deepStrictEqual(
      [asked.map(question => question.surface), user, password],
      [
        ['plainInput', 'maskedInput'],
        {printed: 'alex\n', status: 0},
        {printed: 'secret\n', status: 0},
      ],
    );
    await relay.close();
  });

  it('a dismissed question gives the program a refusal, so git stops asking', async () => {
    const {relay, program} = await relayScene(() => undefined);
    deepStrictEqual(
      (await program("Password for 'https://h.invalid': ")).status,
      1,
    );
    await relay.close();
  });

  it('closing the relay stops it listening', async () => {
    const {relay, port} = await relayScene(() => 'x');
    await relay.close();
    deepStrictEqual(
      await port.connect(PLACES.endpoint).then(
        () => 'connected',
        () => 'refused',
      ),
      'refused',
    );
  });
});

describe('the access pre-check (card containers-151)', () => {
  /** The pre-check of `input` against a git that ends with `status`, and what it was run with. */
  async function checked(input: string, status: number | null, abort = false) {
    const runs: Array<{
      gitArguments: readonly string[];
      environment: Readonly<Record<string, string>>;
    }> = [];
    let closed = 0;
    const cancellation = new AbortController();
    const outcome = await precheck(
      sourceOf(input),
      'typed',
      {
        openRelay: () =>
          Promise.resolve({
            environment: {GIT_ASKPASS: '/run/launcher'},
            close: () => {
              closed += 1;
              return Promise.resolve();
            },
          }),
        runGit: (gitArguments, environment) => {
          runs.push({gitArguments, environment});
          if (abort) {
            cancellation.abort();
          }
          return Promise.resolve(status);
        },
      },
      cancellation.signal,
    );
    return {outcome, runs, closed};
  }

  it('F-0701 BR-5: git ls-remote of the repository part, never on a terminal, through the relay; exit 0 is reachable', async () => {
    deepStrictEqual(await checked('https://github.com/o/r/tree/main', 0), {
      outcome: 'reachable',
      runs: [
        {
          gitArguments: ['ls-remote', '--', 'https://github.com/o/r'],
          environment: {
            GIT_TERMINAL_PROMPT: '0',
            GIT_ASKPASS: '/run/launcher',
          },
        },
      ],
      closed: 1,
    });
  });

  it('F-0701 7.E1: any other status, or a signal, is unreachable, and the relay is closed either way', async () => {
    deepStrictEqual(
      [
        (await checked('https://h.invalid/r', 128)).outcome,
        (await checked('https://h.invalid/r', null)).outcome,
        (await checked('https://h.invalid/r', 128)).closed,
      ],
      ['unreachable', 'unreachable', 1],
    );
  });

  it('a cancelled check is cancelled, whatever git gave', async () => {
    deepStrictEqual(
      (await checked('https://h.invalid/r', 0, true)).outcome,
      'cancelled',
    );
  });
});
