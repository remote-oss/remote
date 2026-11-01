import {deepStrictEqual} from 'node:assert';
import {TUNNEL_COMMAND} from '../../src/arguments/invocation.ts';
import {
  type Invocation,
  type LoginTerminals,
  openTunnelSession,
  TUNNEL_SUCCESS_LINE,
  type TunnelGate,
} from '../../src/index.ts';
import {RecordingTerminals} from '../../src/testing/recording-terminal.ts';

const INVOCATION: Invocation = {
  program: 'ssh',
  arguments: ['-L', '18111:127.0.0.1:8080', '--', 'alias', TUNNEL_COMMAND],
  environment: {},
};

const LOCAL_PORT = 18111;

/** A tunnel session over a recording terminal, with the gate and the ends it reports. */
function opened(reveal = false, input?: string) {
  const terminals = new RecordingTerminals();
  const session = openTunnelSession(
    terminals,
    INVOCATION,
    LOCAL_PORT,
    reveal,
    input,
  );
  const [terminal] = terminals.opened;
  if (terminal === undefined) {
    throw new Error('no terminal was opened');
  }
  const gates: TunnelGate[] = [];
  void session.gate.then(gate => gates.push(gate));
  const ends: number[] = [];
  session.onEnd(() => ends.push(ends.length));
  const output: string[] = [];
  session.onOutput(text => output.push(text));
  return {terminals, session, terminal, gates, ends, output};
}

/** Lets the settled gate reach `then` handlers. */
async function settled(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

const BUSY_PORT = [
  'bind [127.0.0.1]:18111: Address already in use',
  'channel_setup_fwd_listener_tcpip: cannot listen to port: 18111',
  'Could not request local forwarding.',
].join('\n');

describe('the tunnel session (card ssh-23)', () => {
  it('F-2104 6.2 step 4: opens one terminal named SSH Tunnel with the invocation, not revealed', () => {
    const {terminals} = opened();
    deepStrictEqual(
      terminals.opened.map(terminal => [
        terminal.name,
        terminal.invocation,
        terminal.revealedAtOpen,
      ]),
      [['SSH Tunnel', INVOCATION, false]],
    );
  });

  it('connect-95: the tunnel’s input is not sent before ssh reports it is authenticated, and is sent once after it', () => {
    const {terminal} = opened(false, 'exec sh -c cmd\n');
    const before = [...terminal.sent];
    terminal.write('debug1: Connecting to 192.0.2.10 port 22.\n');
    const stillBefore = [...terminal.sent];
    terminal.write(
      'Authenticated to 192.0.2.10 ([192.0.2.10]:22) using "publickey".\n',
    );
    terminal.write(
      'Authenticated to 192.0.2.10 ([192.0.2.10]:22) using "publickey".\n',
    );
    deepStrictEqual(
      [before, stillBefore, terminal.sent],
      [[], [], ['exec sh -c cmd\n']],
    );
  });

  it('connect-95: a tunnel that ends before ssh is authenticated, or has no input, sends nothing', () => {
    const ended = opened(false, 'exec sh -c cmd\n');
    ended.terminal.end(255);
    const plain = opened();
    plain.terminal.write(
      'Authenticated to 192.0.2.10 ([192.0.2.10]:22) using "publickey".\n',
    );
    deepStrictEqual([ended.terminal.sent, plain.terminal.sent], [[], []]);
  });

  it('F-2308 BR-2: reveals the terminal at the open when asked', () => {
    const {terminal} = opened(true);
    deepStrictEqual(terminal.revealedAtOpen, true);
  });

  it('F-2308 BR-10: the success line after debug lines opens the gate as forwarded', async () => {
    const {terminal, gates} = opened();
    terminal.write(`debug1: one\ndebug1: two\n${TUNNEL_SUCCESS_LINE}\n`);
    await settled();
    deepStrictEqual(gates, [{kind: 'forwarded'}]);
  });

  it('#299: a busy port fails the gate with the first remembered failure line', async () => {
    const {terminal, gates} = opened();
    terminal.write(`${BUSY_PORT}\n${TUNNEL_SUCCESS_LINE}\n`);
    await settled();
    deepStrictEqual(gates, [
      {
        kind: 'forwardFailed',
        line: 'channel_setup_fwd_listener_tcpip: cannot listen to port: 18111',
      },
    ]);
  });

  it('#299: the plain "Could not request local forwarding." line also fails the gate', async () => {
    const {terminal, gates} = opened();
    terminal.write(
      `Could not request local forwarding.\n${TUNNEL_SUCCESS_LINE}\n`,
    );
    await settled();
    deepStrictEqual(gates, [
      {kind: 'forwardFailed', line: 'Could not request local forwarding.'},
    ]);
  });

  it('#299: the bind line alone is not a failure line', async () => {
    const {terminal, gates} = opened();
    terminal.write(
      `bind [127.0.0.1]:18111: Address already in use\n${TUNNEL_SUCCESS_LINE}\n`,
    );
    await settled();
    deepStrictEqual(gates, [{kind: 'forwarded'}]);
  });

  it('#299: a failure of another port does not count', async () => {
    const {terminal, gates} = opened();
    terminal.write(`cannot listen to port: 18112\n${TUNNEL_SUCCESS_LINE}\n`);
    await settled();
    deepStrictEqual(gates, [{kind: 'forwarded'}]);
  });

  it('#299: a longer number that ends in ours does not count', async () => {
    const {terminal, gates} = opened();
    terminal.write(`cannot listen to port: 218111\n${TUNNEL_SUCCESS_LINE}\n`);
    await settled();
    deepStrictEqual(gates, [{kind: 'forwarded'}]);
  });

  it('#299: a longer number that starts with ours does not count', async () => {
    const {terminal, gates} = opened();
    terminal.write(`cannot listen to port: 181110\n${TUNNEL_SUCCESS_LINE}\n`);
    await settled();
    deepStrictEqual(gates, [{kind: 'forwarded'}]);
  });

  it('#299: a line that merely ends in our number after other text counts only after the last marker', async () => {
    const {terminal, gates} = opened();
    terminal.write(
      `note cannot listen to port: 9 cannot listen to port: 18111\n${TUNNEL_SUCCESS_LINE}\n`,
    );
    await settled();
    deepStrictEqual(
      gates.map(gate => gate.kind),
      ['forwardFailed'],
    );
  });

  it('#299: the success line arriving in two pieces still opens the gate', async () => {
    const {terminal, gates} = opened();
    terminal.write('Connected to SSH Ho');
    terminal.write('st - Please do not close this terminal\n');
    await settled();
    deepStrictEqual(gates, [{kind: 'forwarded'}]);
  });

  it('#299: the success line with a carriage return before the line end is still the line', async () => {
    const {terminal, gates} = opened();
    terminal.write(`${TUNNEL_SUCCESS_LINE}\r\n`);
    await settled();
    deepStrictEqual(gates, [{kind: 'forwarded'}]);
  });

  it('F-2104 7.E10: the terminal ending before any success line ends the gate', async () => {
    const {terminal, gates} = opened();
    terminal.end(255);
    await settled();
    deepStrictEqual(gates, [{kind: 'ended'}]);
  });

  it('#299: the terminal ending after the success line leaves the gate forwarded', async () => {
    const {terminal, gates} = opened();
    terminal.write(`${TUNNEL_SUCCESS_LINE}\n`);
    terminal.end(0);
    await settled();
    deepStrictEqual(gates, [{kind: 'forwarded'}]);
  });

  it('#299: the end after the gate still reaches onEnd, once', async () => {
    const {terminal, ends} = opened();
    terminal.write(`${TUNNEL_SUCCESS_LINE}\n`);
    terminal.end(0);
    await settled();
    deepStrictEqual(ends, [0]);
  });

  it('#299: a failure line after the success line does not change the gate', async () => {
    const {terminal, gates} = opened();
    terminal.write(`${TUNNEL_SUCCESS_LINE}\n${BUSY_PORT}\n`);
    await settled();
    deepStrictEqual(gates, [{kind: 'forwarded'}]);
  });

  it('#299: a second success line after a failed forward does not change the answer', async () => {
    const {terminal, session} = opened();
    terminal.write(
      `${BUSY_PORT}\n${TUNNEL_SUCCESS_LINE}\n${TUNNEL_SUCCESS_LINE}\n`,
    );
    deepStrictEqual((await session.gate).kind, 'forwardFailed');
  });

  it('F-2104 6.2 step 4: a question without a line end leaves the gate pending', async () => {
    const {terminal, gates} = opened();
    terminal.write("alex@dev's password: ");
    await settled();
    deepStrictEqual(gates, []);
  });

  it('T2: the question reaches onOutput as it was written', () => {
    const {terminal, output} = opened();
    terminal.write("alex@dev's password: ");
    deepStrictEqual(output, ["alex@dev's password: "]);
  });

  it('F-2308 BR-6: send writes to the terminal', () => {
    const {session, terminal} = opened();
    session.send('pw\r');
    deepStrictEqual(terminal.sent, ['pw\r']);
  });

  it('contracts: stop before the gate disposes the terminal', () => {
    const {session, terminal} = opened();
    session.stop();
    deepStrictEqual(terminal.disposed, true);
  });

  it('contracts: stop before the gate ends the gate', async () => {
    const {session, gates} = opened();
    session.stop();
    await settled();
    deepStrictEqual(gates, [{kind: 'ended'}]);
  });

  it('contracts: stop twice disposes the terminal once', () => {
    const recording = new RecordingTerminals();
    let disposals = 0;
    const counting: LoginTerminals = {
      open: (invocation, name, reveal) => {
        const session = recording.open(invocation, name, reveal);
        return {
          ...session,
          dispose: () => {
            disposals++;
            session.dispose();
          },
        };
      },
    };
    const session = openTunnelSession(counting, INVOCATION, LOCAL_PORT, false);
    session.stop();
    session.stop();
    deepStrictEqual(disposals, 1);
  });

  it('F-2308 BR-10: the success line is the line the tunnel command prints', () => {
    deepStrictEqual(
      TUNNEL_COMMAND.includes(`echo '${TUNNEL_SUCCESS_LINE}'`),
      true,
    );
  });
});
