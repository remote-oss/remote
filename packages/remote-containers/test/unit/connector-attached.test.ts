import {deepStrictEqual} from 'node:assert';
import type {EngineRunOutcome} from '../../src/engine/engine-host.ts';
import {attachedPayloadOf} from '../../src/attach/payload.ts';
import {attachPickKeyOf} from '../../src/attach/pick-record.ts';
import {exits, inspectedJson} from './attach.fixture.ts';
import {inputOf, type Scene, sceneOf} from './connector.fixture.ts';

const PAYLOAD = attachedPayloadOf({containerName: '/web'});
const CONTAINER_ID = 'a'.repeat(64);
const PICK_KEY = attachPickKeyOf({containerName: '/web'});

/** A scene whose engine knows the container `web` in `state` and answers the Alpine step by `alpine`. */
function attachedScene(state: string | undefined, alpine = 1): Scene {
  const scene = sceneOf({}, {attached: true});
  scene.attachPicks.push(PICK_KEY);
  scene.bootstrapAnswer = (argv): EngineRunOutcome | undefined => {
    if (argv[0] === 'inspect') {
      return state === undefined || argv[3] !== 'web'
        ? {kind: 'ran', status: 1, stdout: '', stderr: 'No such container'}
        : exits(0, inspectedJson('web', CONTAINER_ID, state));
    }
    if (argv[0] === 'exec' && argv.includes('sh')) {
      return exits(0, 'node\n');
    }
    if (argv[0] === 'exec' && argv.includes('id')) {
      return exits(0, '1000\n');
    }
    if (argv[0] === 'exec') {
      return exits(alpine);
    }
    return argv[0] === 'start' || argv[0] === 'unpause' ? exits(0) : undefined;
  };
  return scene;
}

describe('the connector of an attached container (card containers-163, #2030)', () => {
  it('F-0601 AC-1, AC-12 (c163-connector-ready): a running container is found, set up and connected, trusted, with its id recorded and found again for the recovery picks', async () => {
    const scene = attachedScene('running');
    const result = await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      {
        trusted: 'trusted' in result && result.trusted,
        connected: 'connectionToken' in result,
        setUps: scene.setUps,
        found: scene.connector.attachedContainer()?.name,
        recorded: scene.attachedIds,
        servers: scene.serverRequests.length,
      },
      {
        trusted: true,
        connected: true,
        setUps: [CONTAINER_ID],
        found: 'web',
        recorded: {[PAYLOAD]: CONTAINER_ID},
        servers: 1,
      },
    );
  });

  it('F-0601 AC-12, F-0602 BR-4 (c163-connector-server): the server is installed for the merged remote user with no volume, the extensions once for each user and the preview line always; the container keeps no label, mount or volume', async () => {
    const scene = attachedScene('running');
    scene.setUpResult = {
      kind: 'setUp',
      mergedConfiguration: {
        remoteUser: 'node',
        customizations: {vscode: [{extensions: ['a.b']}]},
      },
    };
    const exec = scene.bootstrapAnswer;
    scene.bootstrapAnswer = argv => exec(argv);
    await scene.connector.connect(inputOf(PAYLOAD));
    const [request] = scene.serverRequests;
    deepStrictEqual(
      {
        user: request?.remoteUser,
        volume: request?.volumeMounted,
        created: request?.created,
        extensions: request?.defaultExtensions,
        once: request?.extensionsOncePerUser,
        preview: request?.previewNoteAlways,
        engineCalls: scene.engineCalls
          .map(call => call.argv[0])
          .filter(each =>
            ['run', 'create', 'commit', 'volume'].includes(String(each)),
          ),
      },
      {
        user: 'node',
        volume: false,
        created: false,
        extensions: ['a.b'],
        once: true,
        preview: true,
        engineCalls: [],
      },
    );
  });

  it('F-0601 AC-12, F-0602 7.E5 (c163-connector-user): without a merged remote user the container’s own user is the one, and a user the container does not have ends in the set-up failure with nothing installed', async () => {
    const own = attachedScene('running');
    const answer = own.bootstrapAnswer;
    own.bootstrapAnswer = argv =>
      argv[0] === 'exec' && argv.includes('sh')
        ? exits(0, 'app\n')
        : answer(argv);
    await own.connector.connect(inputOf(PAYLOAD));
    const missing = attachedScene('running');
    missing.setUpResult = {
      kind: 'setUp',
      mergedConfiguration: {remoteUser: 'ghost'},
    };
    const known = missing.bootstrapAnswer;
    missing.bootstrapAnswer = argv =>
      argv.includes('id') ? exits(1) : known(argv);
    const result = await missing.connector.connect(inputOf(PAYLOAD));
    const silent = attachedScene('running');
    const quiet = silent.bootstrapAnswer;
    silent.bootstrapAnswer = argv =>
      argv[0] === 'exec' && argv.includes('sh') ? exits(1) : quiet(argv);
    const unknown = await silent.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      [
        own.serverRequests[0]?.remoteUser,
        'kind' in result ? result.kind : undefined,
        missing.serverRequests.length,
        'kind' in unknown ? unknown.kind : undefined,
      ],
      ['app', 'attachFailed', 0, 'attachFailed'],
    );
  });

  it('F-0601 AC-1 (c163-connector-missing): a name no container has ends in the failure that offers another container, and nothing is found', async () => {
    const scene = attachedScene(undefined);
    const result = await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      [
        'kind' in result ? result.kind : undefined,
        scene.setUps,
        scene.connector.attachedContainer(),
      ],
      ['attachedNotFound', [], undefined],
    );
  });

  it('F-0601 AC-1 (c163-connector-stopped): a container that does not run is never started by the connect, and its recovery starts it through the engine it was found with', async () => {
    const scene = attachedScene('exited');
    const result = await scene.connector.connect(inputOf(PAYLOAD));
    const started = await scene.connector.startAttachedContainer();
    deepStrictEqual(
      [
        'kind' in result ? result.kind : undefined,
        scene.setUps,
        started,
        scene.engineCalls.some(call => call.argv[0] === 'start'),
      ],
      ['attachedNotRunning', [], true, true],
    );
  });

  it('F-0601 AC-1 (c163-connector-nothing-found): with no container found the recovery has nothing to start', async () => {
    const scene = attachedScene(undefined);
    await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(await scene.connector.startAttachedContainer(), false);
  });

  it('F-0601 AC-1 (c163-connector-engine): an engine program the settings cannot name ends the connect before the container is looked for', async () => {
    const scene = attachedScene('running');
    scene.dockerPath = 'tools/docker';
    const result = await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      [
        'kind' in result ? result.kind : undefined,
        scene.engineCalls.length,
        scene.setUps,
      ],
      ['engineCheckFailed', 0, []],
    );
  });

  it('F-0601 AC-1 (c163-connector-no-dependencies): without the attach dependencies an attached payload is no authority the connector reads', async () => {
    const scene = sceneOf({});
    const result = await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      'kind' in result ? result.kind : undefined,
      'malformedAuthority',
    );
  });

  it('F-0601 AC-1 (c163-connector-cancel): a connect cancelled while the container is looked for ends as cancelled, and sets nothing up', async () => {
    const scene = attachedScene('running');
    const answer = scene.bootstrapAnswer;
    scene.bootstrapAnswer = argv => {
      scene.connector.cancel();
      return answer(argv);
    };
    const result = await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      ['kind' in result ? result.kind : undefined, scene.setUps],
      ['cancelled', []],
    );
  });

  it('F-0601 AC-1 (c163-connector-gate): a target the user never picked meets the attach warning inside the connector, whichever registration called it: Cancel connects nothing and asks the engine nothing, and confirming records it and goes on', async () => {
    const cancelled = attachedScene('running');
    cancelled.attachPicks.length = 0;
    cancelled.confirmAnswer = false;
    const first = await cancelled.connector.connect(inputOf(PAYLOAD));
    const confirmed = attachedScene('running');
    confirmed.attachPicks.length = 0;
    await confirmed.connector.connect(inputOf(PAYLOAD));
    await confirmed.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      {
        refused: 'kind' in first ? first.kind : undefined,
        engineAsked: cancelled.engineCalls.length,
        recorded: cancelled.attachPicks,
        confirmedPicks: confirmed.attachPicks,
        questions: confirmed.confirmations,
        setUps: confirmed.setUps.length,
      },
      {
        refused: 'attachWarningRefused',
        engineAsked: 0,
        recorded: [],
        confirmedPicks: [PICK_KEY],
        questions: 1,
        setUps: 2,
      },
    );
  });

  it('F-0601 AC-1 (c163-connector-cancel-user): a connect cancelled while the remote user is looked for ends as cancelled, and installs nothing', async () => {
    const scene = attachedScene('running');
    const answer = scene.bootstrapAnswer;
    scene.bootstrapAnswer = argv => {
      if (argv[0] === 'exec' && argv.includes('sh')) {
        scene.connector.cancel();
        return exits(1);
      }
      return answer(argv);
    };
    const result = await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      ['kind' in result ? result.kind : undefined, scene.serverRequests.length],
      ['cancelled', 0],
    );
  });
});
