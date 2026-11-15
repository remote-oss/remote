import {deepStrictEqual} from 'node:assert';
import {forwarderOf, type TunnelHost} from '../../src/ports/forwarder.ts';

interface Scene {
  opened: unknown[];
  errors: string[];
  warned: string[];
  informed: string[];
  /** The window's port attribute settings in effect. */
  effective: Record<string, unknown>;
  /** Tells the forwarder's listeners that the attribute settings changed. */
  change(): void;
  /** Runs the timers set so far. */
  elapse(): void;
  forwarder: ReturnType<typeof forwarderOf>;
}

/** The forwarder over fakes; the ports in `refused` reject. */
function sceneOf(refused: readonly number[] = []): Scene {
  const listeners = new Set<() => void>();
  const timers = new Map<() => void, number>();
  const scene: Scene = {
    opened: [],
    errors: [],
    warned: [],
    informed: [],
    effective: {},
    change: () => {
      for (const listener of [...listeners]) {
        listener();
      }
    },
    elapse: () => {
      for (const timer of [...timers.keys()]) {
        timer();
      }
    },
    forwarder: undefined as never,
  };
  const tunnels: TunnelHost = {
    openTunnel: options => {
      scene.opened.push(options);
      return refused.includes(options.remoteAddress.port)
        ? Promise.reject(new Error('refused'))
        : Promise.resolve({});
    },
  };
  scene.forwarder = forwarderOf({
    tunnels,
    showError: text => {
      scene.errors.push(text);
    },
    logger: {
      warn: message => {
        scene.warned.push(message);
      },
      info: message => {
        scene.informed.push(message);
      },
    },
    translate: template => template,
    attributes: {
      effective: key => scene.effective[key],
      onChanged: listener => {
        listeners.add(listener);
        return {
          dispose: () => {
            listeners.delete(listener);
          },
        };
      },
    },
    scheduler: {
      setTimer: (milliseconds, callback) => {
        timers.set(callback, milliseconds);
        return () => {
          timers.delete(callback);
        };
      },
    },
  });
  return scene;
}

/** Lets the promises that are ready settle. */
async function settled(): Promise<void> {
  await new Promise(resolve => {
    setImmediate(resolve);
  });
}

describe('the forwarder (card containers-72)', () => {
  it('F-1101 AC-1, BR-27: one tunnel is opened per forward, in order, with no label and no local port', async () => {
    const scene = sceneOf();
    await scene.forwarder.forward({
      forwardPorts: [3000, 'side:4000'],
      portsAttributes: undefined,
      otherPortsAttributes: undefined,
    });
    deepStrictEqual(scene.opened, [
      {remoteAddress: {host: 'localhost', port: 3000}},
      {remoteAddress: {host: 'side', port: 4000}},
    ]);
  });

  it('F-1101 AC-18, BR-11: 443 and 8443 open with https, and a third port with no protocol', async () => {
    const scene = sceneOf();
    await scene.forwarder.forward({
      forwardPorts: [443, 8443, 9000],
      portsAttributes: undefined,
      otherPortsAttributes: undefined,
    });
    deepStrictEqual(scene.opened, [
      {remoteAddress: {host: 'localhost', port: 443}, protocol: 'https'},
      {remoteAddress: {host: 'localhost', port: 8443}, protocol: 'https'},
      {remoteAddress: {host: 'localhost', port: 9000}},
    ]);
  });

  it('F-1101 AC-18: a port whose attributes set a protocol is opened without https', async () => {
    const scene = sceneOf();
    await scene.forwarder.forward({
      forwardPorts: [443],
      portsAttributes: {'443': {protocol: 'http'}},
      otherPortsAttributes: undefined,
    });
    deepStrictEqual(scene.opened, [
      {remoteAddress: {host: 'localhost', port: 443}},
    ]);
  });

  it('F-1101 AC-16, S278: each dashed entry shows one error notice with its text, and the forwards go on', async () => {
    const scene = sceneOf();
    await scene.forwarder.forward({
      forwardPorts: [3000, '-3000', -5],
      portsAttributes: {'-7': {}},
      otherPortsAttributes: undefined,
    });
    deepStrictEqual(
      [scene.errors, scene.opened],
      [
        [
          'Port number must not start with a dash: -3000',
          'Port number must not start with a dash: -5',
          'Port number must not start with a dash: -7',
        ],
        [{remoteAddress: {host: 'localhost', port: 3000}}],
      ],
    );
  });

  it('F-1101 AC-13: a configuration with nothing dashed shows nothing', async () => {
    const scene = sceneOf();
    await scene.forwarder.forward({
      forwardPorts: [3000],
      portsAttributes: undefined,
      otherPortsAttributes: undefined,
    });
    deepStrictEqual(scene.errors, []);
  });

  it('F-1101 BR-16: a refused tunnel is logged once and dropped, shows nothing, and the next forward is still opened', async () => {
    const scene = sceneOf([3000]);
    await scene.forwarder.forward({
      forwardPorts: [3000, 4000],
      portsAttributes: undefined,
      otherPortsAttributes: undefined,
    });
    deepStrictEqual(
      [scene.warned, scene.errors, scene.opened.length],
      [['the forward of localhost:3000 was refused: refused'], [], 2],
    );
  });

  it('F-1101 BR-16: a refusal that is not an error is logged as its text', async () => {
    const warned: string[] = [];
    const forwarder = forwarderOf({
      tunnels: {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a refusal that is not an Error
        openTunnel: () => Promise.reject('plain'),
      },
      showError: () => undefined,
      logger: {
        warn: message => {
          warned.push(message);
        },
        info: () => undefined,
      },
      translate: template => template,
      attributes: {
        effective: () => undefined,
        onChanged: () => ({dispose: () => undefined}),
      },
      scheduler: {setTimer: () => () => undefined},
    });
    await forwarder.forward({
      forwardPorts: [3000],
      portsAttributes: undefined,
      otherPortsAttributes: undefined,
    });
    deepStrictEqual(warned, [
      'the forward of localhost:3000 was refused: plain',
    ]);
  });

  it('F-1101 BR-10, AC-35: the forwards open only once the written port attributes are in effect, and the notices come first', async () => {
    const scene = sceneOf();
    const written = {
      'remote.portsAttributes': {'3000': {label: 'Web'}},
      'remote.otherPortsAttributes': {label: 'Other'},
    };
    const forwarding = scene.forwarder.forward({
      forwardPorts: [3000, 4000, '-5'],
      portsAttributes: undefined,
      otherPortsAttributes: undefined,
      attributeSettings: written,
    });
    await settled();
    const beforeSettings = [scene.errors.length, scene.opened.length];
    scene.effective = {...written};
    scene.change();
    await forwarding;
    deepStrictEqual(
      [beforeSettings, scene.opened.length, scene.informed],
      [[1, 0], 2, []],
    );
  });

  it('F-1101 BR-10: the forwards open at once when the written attributes are already in effect', async () => {
    const scene = sceneOf();
    scene.effective = {'remote.portsAttributes': {'3000': {label: 'Web'}}};
    await scene.forwarder.forward({
      forwardPorts: [3000],
      portsAttributes: undefined,
      otherPortsAttributes: undefined,
      attributeSettings: {'remote.portsAttributes': {'3000': {label: 'Web'}}},
    });
    deepStrictEqual(scene.opened.length, 1);
  });

  it('F-1101 BR-10: attributes that never arrive hold the forwards only until the bound, which is logged', async () => {
    const scene = sceneOf();
    const forwarding = scene.forwarder.forward({
      forwardPorts: [3000],
      portsAttributes: undefined,
      otherPortsAttributes: undefined,
      attributeSettings: {'remote.portsAttributes': {'3000': {label: 'Web'}}},
    });
    await settled();
    scene.elapse();
    await forwarding;
    deepStrictEqual(
      [scene.opened.length, scene.informed],
      [
        1,
        [
          'the declared forwards open before the port attributes are in effect in the window',
        ],
      ],
    );
  });

  it('F-1101 AC-1: a connection that declares nothing opens nothing', async () => {
    const scene = sceneOf();
    await scene.forwarder.forward(undefined);
    deepStrictEqual([scene.opened, scene.errors], [[], []]);
  });
});
