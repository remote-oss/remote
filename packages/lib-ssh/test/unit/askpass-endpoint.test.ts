import {deepStrictEqual} from 'node:assert';
import type {EndpointConnection} from 'lib-helper';
import {FakeEndpointPort} from 'lib-helper/testing/fake-endpoint';
import {AskpassEndpoint, type OpenPrompt} from '../../src/index.ts';

const ENDPOINT = '/run/ra-0123456789abcdef.sock';
const NONCE = 'askpass-nonce';
const PASSWORD_QUESTION = "dev@h.invalid's password: ";
const FINGERPRINT_QUESTION = [
  'The authenticity of host h.invalid (192.0.2.10) cant be established.',
  'ED25519 key fingerprint is SHA256:abcdef.',
  'Are you sure you want to continue connecting (yes/no/[fingerprint])?',
].join('\n');

async function settled(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    await Promise.resolve();
  }
}

/** A connection of the askpass program, with what the endpoint sent it. */
interface Program {
  connection: EndpointConnection;
  received: unknown[];
  closed: boolean;
}

describe('askpass endpoint', () => {
  let port: FakeEndpointPort;
  let endpoint: AskpassEndpoint;
  let opened: OpenPrompt[];
  let closedPrompts: number[];

  async function connect(): Promise<Program> {
    const connection = await port.connect(ENDPOINT);
    const program: Program = {connection, received: [], closed: false};
    connection.onMessage(message => program.received.push(message));
    connection.onClose(() => {
      program.closed = true;
    });
    return program;
  }

  async function askQuestion(
    text = PASSWORD_QUESTION,
    nonce = NONCE,
  ): Promise<Program> {
    const program = await connect();
    program.connection.send({type: 'ask', nonce, text});
    await settled();
    return program;
  }

  beforeEach(async () => {
    port = new FakeEndpointPort();
    opened = [];
    closedPrompts = [];
    endpoint = new AskpassEndpoint({
      nonce: NONCE,
      displayHost: 'h.invalid',
      onPrompt: prompt => opened.push(prompt),
      onPromptClosed: promptId => closedPrompts.push(promptId),
    });
    await port.listen(ENDPOINT, connection => {
      endpoint.accept(connection);
    });
  });

  it('opens a masked input for a password question', async () => {
    await askQuestion();
    deepStrictEqual(opened, [
      {promptId: 1, surface: 'maskedInput', text: PASSWORD_QUESTION},
    ]);
  });

  it('opens a pick for a host key question', async () => {
    await askQuestion(FINGERPRINT_QUESTION);
    deepStrictEqual(opened, [
      {promptId: 1, surface: 'fingerprintPick', text: FINGERPRINT_QUESTION},
    ]);
  });

  it('closes a connection that presents another nonce, and opens nothing', async () => {
    const program = await askQuestion(PASSWORD_QUESTION, 'other');
    await settled();
    deepStrictEqual([program.closed, opened], [true, []]);
  });

  it('closes a connection whose first message is no question', async () => {
    const program = await connect();
    program.connection.send({type: 'hello', nonce: NONCE});
    await settled();
    deepStrictEqual([program.closed, opened], [true, []]);
  });

  it('closes a connection that asks twice, and closes its question', async () => {
    const program = await askQuestion();
    program.connection.send({type: 'ask', nonce: NONCE, text: 'again'});
    await settled();
    deepStrictEqual([program.closed, closedPrompts], [true, [1]]);
  });

  it('passes the answer to the program and closes its connection', async () => {
    const program = await askQuestion();
    const accepted = endpoint.answer(1, 'secret');
    await settled();
    deepStrictEqual(
      [accepted, program.received, program.closed, closedPrompts],
      [true, [{type: 'answer', text: 'secret'}], true, []],
    );
  });

  it('takes the first answer only', async () => {
    await askQuestion();
    deepStrictEqual(
      [endpoint.answer(1, 'first'), endpoint.answer(1, 'second')],
      [true, false],
    );
  });

  it('refuses an answer to a question that was never open', () => {
    deepStrictEqual(endpoint.answer(7, 'text'), false);
  });

  it('lists the open questions, oldest first, and not the answered one', async () => {
    await askQuestion('first question');
    await askQuestion('second question');
    await askQuestion('third question');
    endpoint.answer(2, 'text');
    deepStrictEqual(
      endpoint.pending().map(prompt => prompt.text),
      ['first question', 'third question'],
    );
  });

  it('closes a question that ssh dropped, and refuses its late answer', async () => {
    const program = await askQuestion();
    program.connection.close();
    await settled();
    deepStrictEqual(
      [closedPrompts, endpoint.pending(), endpoint.answer(1, 'late')],
      [[1], [], false],
    );
  });

  it('closes every question and every connection when the login ends', async () => {
    const asking = await askQuestion();
    const idle = await connect();
    endpoint.closeAll();
    await settled();
    deepStrictEqual(
      [closedPrompts, asking.closed, idle.closed, endpoint.pending()],
      [[1], true, true, []],
    );
  });

  it('forgets a connection that closed, so closing all has nothing left to close', async () => {
    const idle = await connect();
    idle.connection.close();
    await settled();
    endpoint.closeAll();
    deepStrictEqual(closedPrompts, []);
  });
});
