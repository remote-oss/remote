import {deepStrictEqual} from 'node:assert';
import {execChannelOver} from '../../src/exec/exec-channel.ts';
import {k8sDialer, k8sExecCommands} from '../../src/attach/k8s-exec.ts';
import type {K8sTarget} from '../../src/attach/k8s-payload.ts';
import {endsWith, fakeEngine, scriptRequest as request} from './fake-engine.ts';

const TARGET: K8sTarget = {
  context: 'kind-lab',
  podname: 'web-1',
  namespace: 'default',
  name: 'app',
  image: 'nginx:1.27',
};

describe('the exec channel of a pod window (card containers-191)', () => {
  it('F-0604 BR-12: a script runs through kubectl exec -i with the prelude as its only command, and no environment on the process', async () => {
    const engine = fakeEngine(endsWith(0));
    await execChannelOver(engine, k8sExecCommands(TARGET)).runScript(
      request(),
      () => undefined,
    );
    const [spawned] = engine.processes;
    deepStrictEqual(
      [spawned?.argv.slice(0, 8), spawned?.environment],
      [
        [
          'exec',
          '-i',
          '--context=kind-lab',
          '--namespace=default',
          'web-1',
          '--container=app',
          '--',
          'sh',
        ],
        undefined,
      ],
    );
  });

  it('R-26: a value reaches the pod only as data on standard input, quoted, and shows in no argument and no process environment', async () => {
    const engine = fakeEngine(endsWith(0));
    await execChannelOver(engine, k8sExecCommands(TARGET)).runScript(
      request({environment: {TOKEN: "it's a s3cret"}}),
      () => undefined,
    );
    const [spawned] = engine.processes;
    deepStrictEqual(
      [
        spawned?.argv.some(argument => argument.includes('s3cret')),
        spawned?.environment,
        spawned
          ?.stdin()
          .toString('utf8')
          .startsWith("export TOKEN='it'\\''s a s3cret'\necho hi"),
      ],
      [false, undefined, true],
    );
  });

  it('F-0604 BR-12: the byte count of the prelude covers the export lines and the script, so the input after it is the script’s own', async () => {
    const engine = fakeEngine(endsWith(0));
    await execChannelOver(engine, k8sExecCommands(TARGET)).runScript(
      request({environment: {ONE: '1'}, input: {kind: 'text', text: 'DATA'}}),
      () => undefined,
    );
    const [spawned] = engine.processes;
    const prelude = spawned?.argv.at(-1) ?? '';
    const count = Number(/count=(\d+)/.exec(prelude)?.[1]);
    const written = spawned?.stdin().toString('utf8') ?? '';
    deepStrictEqual(
      [written.slice(0, count), written.slice(count)],
      ["export ONE='1'\necho hi", 'DATA'],
    );
  });

  it('F-0604 BR-12: a variable name a shell would not take is refused before any process', async () => {
    const engine = fakeEngine(endsWith(0));
    const outcome = await execChannelOver(
      engine,
      k8sExecCommands(TARGET),
    ).runScript(request({environment: {'a b': '1'}}), () => undefined);
    deepStrictEqual([outcome.kind, engine.processes.length], ['failed', 0]);
  });

  it('F-0604 BR-23: a kill with nothing on stderr is the script’s own result, since no inspect says the pod is gone', async () => {
    const engine = fakeEngine(endsWith(137));
    const outcome = await execChannelOver(
      engine,
      k8sExecCommands(TARGET),
    ).runScript(request(), () => undefined);
    deepStrictEqual([outcome.kind, engine.runs.length], ['exited', 0]);
  });

  it('F-0604 BR-12: a file is unpacked by tar -x through kubectl exec -i, and the channel is named by namespace, pod and container', async () => {
    const engine = fakeEngine(endsWith(0));
    const channel = execChannelOver(engine, k8sExecCommands(TARGET));
    deepStrictEqual(channel.identity(), 'default/web-1/app');
    deepStrictEqual(k8sExecCommands(TARGET).copy('/home/user/.server'), [
      'exec',
      '-i',
      '--context=kind-lab',
      '--namespace=default',
      'web-1',
      '--container=app',
      '--',
      'tar',
      '-x',
      '-f',
      '-',
      '-C',
      '/home/user/.server',
    ]);
  });

  it('F-0604 BR-12: the dialer runs the relay with the installed node through kubectl exec -i, and refuses a socket target', async () => {
    const engine = fakeEngine(endsWith(0));
    const dialer = k8sDialer(engine, TARGET, '/h/.s/node', '/h/.s/relay.js');
    const refused = await dialer.dial({kind: 'socket', path: '/x'}).then(
      () => 'dialled',
      (caught: unknown) => String(caught),
    );
    const dialled = dialer.dial({kind: 'port', port: 4242});
    await Promise.resolve();
    deepStrictEqual(
      [refused, engine.processes[0]?.argv.slice(-3)],
      [
        'Error: a socket target is not available in a container',
        ['/h/.s/node', '/h/.s/relay.js', '4242'],
      ],
    );
    void dialled;
  });
});
