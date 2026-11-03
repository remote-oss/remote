import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {nodeEndpointPort, type EndpointConnection} from 'lib-helper';
import {FakeEndpointPort} from 'lib-helper/testing/fake-endpoint';
import {
  AskpassEndpoint,
  askpassEndpointPath,
  askpassEnvironment,
  DEFAULT_FIRST_MESSAGE_MILLISECONDS,
  ENDPOINT_VARIABLE,
  NONCE_VARIABLE,
  runAskpassProgram,
} from '../../src/index.ts';

const ENDPOINT = '/run/ra-0123456789abcdef.sock';
const NONCE = 'askpass-nonce';
const ENVIRONMENT = {[ENDPOINT_VARIABLE]: ENDPOINT, [NONCE_VARIABLE]: NONCE};

describe('askpass program', () => {
  let port: FakeEndpointPort;
  let output: string[];
  let asked: unknown[];

  function runProgram(
    programArguments: readonly string[] = ['password: '],
    environment: Record<string, string> = ENVIRONMENT,
  ): Promise<number> {
    return runAskpassProgram({
      programArguments,
      environment,
      port,
      output: text => output.push(text),
    });
  }

  /** An endpoint that answers every question with `reply`, or closes the connection when it is undefined. */
  async function listenAnswering(reply: unknown): Promise<void> {
    await port.listen(ENDPOINT, (connection: EndpointConnection) => {
      connection.onMessage(message => {
        asked.push(message);
        if (reply === undefined) {
          connection.close();
          return;
        }
        connection.send(reply);
      });
    });
  }

  beforeEach(() => {
    port = new FakeEndpointPort();
    output = [];
    asked = [];
  });

  it('prints the answer with a line end and exits 0', async () => {
    await listenAnswering({type: 'answer', text: 'secret'});
    deepStrictEqual([await runProgram(), output], [0, ['secret\n']]);
  });

  it('asks the question it was given with the nonce of its environment', async () => {
    await listenAnswering({type: 'answer', text: 'x'});
    await runProgram(['Enter passphrase for key k: ']);
    deepStrictEqual(asked, [
      {type: 'ask', nonce: NONCE, text: 'Enter passphrase for key k: '},
    ]);
  });

  it('exits 1 and prints nothing when the endpoint closes the question', async () => {
    await listenAnswering(undefined);
    deepStrictEqual([await runProgram(), output], [1, []]);
  });

  it('connect-115, F-2307 AC-16: a refused permission question prints an empty line and exits 0, which ssh takes as allowed', async () => {
    await listenAnswering(undefined);
    deepStrictEqual(
      [
        await runProgram(['Add key k (c) to agent?'], {
          ...ENVIRONMENT,
          SSH_ASKPASS_PROMPT: 'confirm',
        }),
        output,
      ],
      [0, ['\n']],
    );
  });

  it('connect-115: a refused question of another kind still exits 1', async () => {
    await listenAnswering(undefined);
    deepStrictEqual(
      [
        await runProgram(['Enter passphrase: '], {
          ...ENVIRONMENT,
          SSH_ASKPASS_PROMPT: 'none',
        }),
        output,
      ],
      [1, []],
    );
  });

  it('connect-115: an answered permission question prints the answer as typed', async () => {
    await listenAnswering({type: 'answer', text: 'no'});
    deepStrictEqual(
      [
        await runProgram(['Add key k (c) to agent?'], {
          ...ENVIRONMENT,
          SSH_ASKPASS_PROMPT: 'confirm',
        }),
        output,
      ],
      [0, ['no\n']],
    );
  });

  it('connect-129, F-2102 AC-40: a permission question nothing listens for prints an empty line and exits 0, so a shared connection that outlives its helper stays in use', async () => {
    deepStrictEqual(
      [
        await runProgram([' Allow shared connection to host? '], {
          ...ENVIRONMENT,
          SSH_ASKPASS_PROMPT: 'confirm',
        }),
        output,
      ],
      [0, ['\n']],
    );
  });

  it('connect-129, F-2102 AC-40: the master’s question to open a forward nothing listens for is allowed the same way', async () => {
    deepStrictEqual(
      [
        await runProgram(
          ['Open dynamic forward 127.0.0.1:34779 -> * on 127.0.0.1?'],
          {...ENVIRONMENT, SSH_ASKPASS_PROMPT: 'confirm'},
        ),
        output,
      ],
      [0, ['\n']],
    );
  });

  it('connect-115, connect-129: a permission question of another kind nothing listens for still exits 1 and prints nothing', async () => {
    deepStrictEqual(
      [
        await runProgram(['Add key k (c) to agent?'], {
          ...ENVIRONMENT,
          SSH_ASKPASS_PROMPT: 'confirm',
        }),
        output,
      ],
      [1, []],
    );
  });

  it('connect-129: a password question nothing listens for still exits 1 and prints nothing', async () => {
    deepStrictEqual(
      [
        await runProgram(['password: '], {
          ...ENVIRONMENT,
          SSH_ASKPASS_PROMPT: 'none',
        }),
        output,
      ],
      [1, []],
    );
  });

  it('exits 1 for a reply that is no answer', async () => {
    await listenAnswering({type: 'dance'});
    deepStrictEqual([await runProgram(), output], [1, []]);
  });

  it('exits 1 when nothing listens on the endpoint', async () => {
    deepStrictEqual([await runProgram(), output], [1, []]);
  });

  it('exits 2 without an endpoint in its environment', async () => {
    deepStrictEqual(await runProgram(['q'], {[NONCE_VARIABLE]: NONCE}), 2);
  });

  it('exits 2 without a nonce in its environment', async () => {
    deepStrictEqual(
      await runProgram(['q'], {[ENDPOINT_VARIABLE]: ENDPOINT}),
      2,
    );
  });

  it('exits 2 without a question', async () => {
    deepStrictEqual(await runProgram([]), 2);
  });
});

describe('askpass over a socket', () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'askpass-'));
  });

  afterEach(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  it('carries a question to a window and its answer back, on a socket only the user can open', async () => {
    const socket = askpassEndpointPath(
      process.platform,
      folder,
      'helper',
      NONCE,
    );
    const port = nodeEndpointPort(process.platform);
    const endpoint = new AskpassEndpoint({
      nonce: NONCE,
      classify: () => 'maskedInput',
      scheduler: {setTimer: () => () => undefined},
      firstMessageMilliseconds: DEFAULT_FIRST_MESSAGE_MILLISECONDS,
      logLine: () => undefined,
      onPrompt: prompt => {
        endpoint.answer(prompt.promptId, `answer to ${prompt.text}`);
      },
      onPromptClosed: () => undefined,
    });
    const server = await port.listen(socket, connection => {
      endpoint.accept(connection);
    });
    const output: string[] = [];
    const environment = askpassEnvironment({
      launcher: '/launcher',
      endpoint: socket,
      nonce: NONCE,
      external: false,
    });
    const status = await runAskpassProgram({
      programArguments: ['password: '],
      environment,
      port,
      output: text => output.push(text),
    });
    await server.close();
    deepStrictEqual(
      [status, output, statSync(socket, {throwIfNoEntry: false})],
      [0, ['answer to password: \n'], undefined],
    );
  });
});
