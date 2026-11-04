import {deepStrictEqual} from 'node:assert';
import type {EngineRunOutcome} from '../../src/engine/engine-host.ts';
import {attachedPayloadOf} from '../../src/attach/payload.ts';
import {exits, inspectedJson} from './attach.fixture.ts';
import {inputOf, type Scene, sceneOf} from './connector.fixture.ts';

const PAYLOAD = attachedPayloadOf({containerName: '/web'});
const ID = 'a'.repeat(64);

/** A scene whose engine knows the container `web` in `state` and answers the Alpine step by `alpine`. */
function attachedScene(state: string | undefined, alpine = 1): Scene {
  const scene = sceneOf({}, {attached: true});
  scene.bootstrapAnswer = (argv): EngineRunOutcome | undefined => {
    if (argv[0] === 'inspect') {
      return state === undefined || argv[3] !== 'web'
        ? {kind: 'ran', status: 1, stdout: '', stderr: 'No such container'}
        : exits(0, inspectedJson('web', ID, state));
    }
    if (argv[0] === 'exec') {
      return exits(alpine);
    }
    return argv[0] === 'start' || argv[0] === 'unpause' ? exits(0) : undefined;
  };
  return scene;
}

describe('the connector of an attached container (card containers-163, #2030)', () => {
  it('F-0601 AC-1 (c163-connector-ready): a running container is found, set up and left found for the recovery picks; the connect itself comes later', async () => {
    const scene = attachedScene('running');
    const result = await scene.connector.connect(inputOf(PAYLOAD));
    deepStrictEqual(
      {
        connected: 'connectionToken' in result,
        failure: 'kind' in result ? result.kind : undefined,
        setUps: scene.setUps,
        found: scene.connector.attachedContainer()?.name,
      },
      {
        connected: false,
        failure: 'attachFailed',
        setUps: [ID],
        found: 'web',
      },
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
});
