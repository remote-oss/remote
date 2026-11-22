import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {HeldConnection} from '../../src/connect/connector.ts';
import type {ListedContainer} from '../../src/explorer/listed-containers.ts';
import type {ListedVolume} from '../../src/explorer/listed-volumes.ts';
import type {ContainerEventsSource} from '../../src/explorer/targets-events.ts';
import {
  showVolumes,
  showVolumesWhenRegistered,
  volumeItemOf,
  type VolumesProvider,
  type VolumesViewPorts,
} from '../../src/explorer/volumes-view.ts';
import {views} from '../../src/identifiers.generated.ts';
import type {VolumeRow} from '../../src/explorer/volumes-model.ts';
import {fakeTreeView} from './fake-tree-view.ts';
import {settled} from './pending.ts';

const CLOCK = Date.parse('2026-11-22T12:00:00Z');

/** A connection the window holds; the view asks only whether there is one. */
const HELD: HeldConnection = {
  containerId: 'held',
  hostPath: '/held',
  remoteWorkspaceFolder: '/workspaces/held',
  engine: {
    // eslint-disable-next-line id-length -- the port's method is named run
    run: () => Promise.resolve({kind: 'failed', detail: 'not used'}),
    spawn: () => Promise.resolve({kind: 'failed', detail: 'not used'}),
  },
  configFile: '/held/devcontainer.json',
  created: false,
};

/** What the fakes steer and record. */
interface Scene {
  commands: string[];
  volumes: ListedVolume[] | Error;
  containers: ListedContainer[];
  held: HeldConnection | undefined;
  contexts: boolean[];
  provider: VolumesProvider | undefined;
  visibility: Array<(visible: boolean) => void>;
  changed: number;
  reads: number;
  events: string[];
  rebuild: (() => Promise<unknown>) | undefined;
  engineListeners: Array<() => void>;
  pathListeners: Array<() => void>;
  trustListeners: Array<() => void>;
  disposed: string[];
  timers: Array<() => void>;
  sink: MemorySink;
}

function sceneOf(): Scene {
  return {
    commands: [`${views.devVolumes}.focus`],
    volumes: [],
    containers: [],
    held: undefined,
    contexts: [],
    provider: undefined,
    visibility: [],
    changed: 0,
    reads: 0,
    events: [],
    rebuild: undefined,
    engineListeners: [],
    pathListeners: [],
    trustListeners: [],
    disposed: [],
    timers: [],
    sink: new MemorySink(),
  };
}

function portsOf(scene: Scene): VolumesViewPorts & {
  setTimer(milliseconds: number, callback: () => void): () => void;
} {
  const events: ContainerEventsSource = {
    watch: rebuild => {
      scene.rebuild = rebuild;
      return {
        start: () => {
          scene.events.push('start');
        },
        stop: () => {
          scene.events.push('stop');
        },
      };
    },
  };
  function subscription(listeners: Array<() => void>, name: string) {
    return (listener: () => void) => {
      listeners.push(listener);
      return {
        dispose: () => {
          scene.disposed.push(name);
        },
      };
    };
  }
  return {
    editor: {
      commandIds: () => Promise.resolve(scene.commands),
      setContext: (key, value) => {
        scene.contexts.push(value);
        return Promise.resolve();
      },
      createTreeView: (viewId, provider) => {
        scene.provider = provider;
        provider.onDidChangeTreeData(() => {
          scene.changed += 1;
        });
        return fakeTreeView(scene, 'tree');
      },
    },
    listing: () => ({
      volumes: () => {
        scene.reads += 1;
        return scene.volumes instanceof Error
          ? Promise.reject(scene.volumes)
          : Promise.resolve(scene.volumes);
      },
      containers: () => Promise.resolve(scene.containers),
    }),
    events,
    held: () => scene.held,
    now: () => CLOCK,
    onEngineChange: subscription(scene.engineListeners, 'engine'),
    onDockerPathChange: subscription(scene.pathListeners, 'path'),
    onTrustGranted: subscription(scene.trustListeners, 'trust'),
    setTimer: (milliseconds, callback) => {
      scene.timers.push(callback);
      return () => undefined;
    },
    translate: template => template,
    logger: createLogger(scene.sink, {minimumLevel: () => 'info'}),
  };
}

function volume(name: string, createdAt = CLOCK - 60_000): ListedVolume {
  return {name, labels: {}, createdAt};
}

async function namesOf(scene: Scene): Promise<string[]> {
  const rows = (await scene.provider?.getChildren(undefined)) ?? [];
  return rows.map(entry => entry.name);
}

describe('the Dev Volumes view (card containers-167)', () => {
  it('F-0904 AC-1, AC-2: the view fills its rows from the engine’s volumes, and the welcome key is on only while there is no entry', async () => {
    const scene = sceneOf();
    scene.volumes = [];
    const empty = await showVolumes(portsOf(scene));
    scene.volumes = [volume('plain')];
    await empty?.refresh();
    deepStrictEqual(
      [scene.contexts, await namesOf(scene)],
      [[true, false], ['plain']],
    );
  });

  it('F-0904 AC-3, AC-7: a entry’s item carries its raw name as id, its kind as the context value, the description when it has one and its tooltip lines', () => {
    const entry: VolumeRow = {
      name: 'raw-name',
      kind: 'uniqueDevVolume',
      label: 'owner/repo',
      description: '#7',
      icon: 'file-symlink-directory',
      viewItem: 'uniqueDevVolume',
      tooltip: [{icon: 'vm', text: 'None'}],
    };
    deepStrictEqual(
      [
        volumeItemOf(entry),
        volumeItemOf({...entry, description: ''}).description,
      ],
      [
        {
          id: 'raw-name',
          label: 'owner/repo',
          description: '#7',
          tooltip: [{icon: 'vm', text: 'None'}],
          contextValue: 'uniqueDevVolume',
          expanded: false,
          icon: {kind: 'theme', id: 'file-symlink-directory'},
        },
        undefined,
      ],
    );
  });

  it('F-0904 AC-24, AC-30: Docker unusable when the view first fills gives no tree view and no welcome, and Refresh fails with the text core shows for a command that is not there', async () => {
    const scene = sceneOf();
    scene.volumes = new Error('Cannot connect to the Docker daemon');
    const view = await showVolumes(portsOf(scene));
    const refused = await view?.refresh().then(
      () => 'refreshed',
      (caught: unknown) =>
        caught instanceof Error ? caught.message : String(caught),
    );
    view?.dispose();
    deepStrictEqual(
      [scene.provider, scene.contexts, refused, scene.sink.lines.length > 0],
      [
        undefined,
        [],
        "command 'remote-containers.explorerVolumesRefresh' not found",
        true,
      ],
    );
  });

  it('F-0904 AC-38: Docker lost after the start blanks the view, no rows and no welcome, and the rows come back with the next read', async () => {
    const scene = sceneOf();
    scene.volumes = [volume('plain')];
    const view = await showVolumes(portsOf(scene));
    scene.volumes = new Error('gone');
    await view?.refresh();
    const blank = [scene.contexts.at(-1), await namesOf(scene)];
    scene.volumes = [volume('plain'), volume('later')];
    await view?.refresh();
    deepStrictEqual(
      [
        blank,
        scene.contexts.at(-1),
        (await namesOf(scene)).length,
        scene.changed,
      ],
      [[false, []], false, 2, 2],
    );
  });

  it('F-0904 AC-26, BR-12: the events run only while the view is visible, a visible view rebuilds, and a rebuild goes on once however many ask', async () => {
    const scene = sceneOf();
    scene.volumes = [volume('plain')];
    const view = await showVolumes(portsOf(scene));
    scene.volumes = [volume('plain'), volume('made-outside')];
    scene.visibility[0]?.(true);
    await settled();
    const visible = [[...scene.events], await namesOf(scene)];
    const reads = scene.reads;
    await Promise.all([scene.rebuild?.(), scene.rebuild?.()]);
    scene.visibility[0]?.(false);
    deepStrictEqual(
      [
        visible,
        scene.reads - reads,
        scene.events.at(-1),
        scene.engineListeners.length,
        scene.disposed,
      ],
      [
        [
          ['start', 'start'],
          ['made-outside', 'plain'],
        ],
        1,
        'stop',
        1,
        ['engine'],
      ],
    );
    view?.dispose();
  });

  it('F-0201 AC-39, AC-40: a change of the engine, the Docker program or the trust reads the rows again unless the window holds a connection, and a change during a read waits for it', async () => {
    const scene = sceneOf();
    scene.volumes = [volume('plain')];
    await showVolumes(portsOf(scene));
    scene.visibility[0]?.(true);
    await settled();
    scene.volumes = [volume('plain'), volume('after-path')];
    scene.pathListeners[0]?.();
    await settled();
    const afterPath = await namesOf(scene);
    scene.volumes = [volume('after-trust')];
    scene.trustListeners[0]?.();
    await settled();
    const afterTrust = await namesOf(scene);
    scene.held = HELD;
    scene.volumes = [volume('held')];
    scene.engineListeners[0]?.();
    await settled();
    const whileHeld = await namesOf(scene);
    scene.held = undefined;
    scene.volumes = [volume('during')];
    const reading = scene.rebuild?.();
    scene.engineListeners[0]?.();
    await reading;
    await settled();
    deepStrictEqual(
      [afterPath, afterTrust, whileHeld, await namesOf(scene)],
      [['after-path', 'plain'], ['after-trust'], ['after-trust'], ['during']],
    );
  });

  it('F-0904 AC-1: a view that core has not registered shows nothing, and one that registers later is shown and refreshed through the handle', async () => {
    const scene = sceneOf();
    scene.commands = [];
    scene.volumes = [volume('plain')];
    const handle = showVolumesWhenRegistered(portsOf(scene));
    await settled();
    const before = scene.provider;
    scene.commands = [`${views.devVolumes}.focus`];
    scene.timers.shift()?.();
    await settled();
    await handle.refresh();
    handle.dispose();
    handle.dispose();
    deepStrictEqual(
      [before, scene.provider !== undefined, scene.disposed.includes('tree')],
      [undefined, true, true],
    );
  });
});
