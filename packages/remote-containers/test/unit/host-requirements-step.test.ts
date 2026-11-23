import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {
  DaemonFigures,
  HostRequirements,
} from '../../src/engine/host-requirements.ts';
import {
  type HostRequirementsPorts,
  hostRequirementsAccepted,
  type RequirementsRequest,
} from '../../src/open/host-requirements-step.ts';

const BYTES_PER_GIB = 1024 ** 3;
const NEVER = new AbortController().signal;
const DAEMON: DaemonFigures = {
  cpus: 4,
  memory: 16 * BYTES_PER_GIB,
  nvidia: false,
};
const FILE = '/w/p/.devcontainer/devcontainer.json';

interface Scene {
  daemon: DaemonFigures | undefined;
  recorded: HostRequirements | undefined;
  text: string | undefined;
  /** Why the image is not in the local store; none when it is local. */
  missing: string | undefined;
  accepted: boolean;
  dialogs: Array<[string, string, string]>;
  queries: string[];
  sink: MemorySink;
}

/** The ports over a scene a row steers, recording what the step asked. */
function portsOf(scene: Scene): HostRequirementsPorts {
  return {
    daemonFigures: base => {
      scene.queries.push(`daemonFigures ${String(base)}`);
      return Promise.resolve(scene.daemon);
    },
    containerRequirements: (base, identity) => {
      scene.queries.push(`containerRequirements ${identity.configFile}`);
      return Promise.resolve(scene.recorded);
    },
    imageMissing: (base, image) => {
      scene.queries.push(`imageMissing ${image}`);
      return Promise.resolve(scene.missing);
    },
    readText: file => {
      scene.queries.push(`readText ${file}`);
      return Promise.resolve(scene.text);
    },
    confirm: (message, detail, acceptLabel) => {
      scene.dialogs.push([message, detail, acceptLabel]);
      return Promise.resolve(scene.accepted);
    },
    translate: template => template,
    logger: createLogger(scene.sink, {minimumLevel: () => 'debug'}),
  };
}

function sceneOf(): Scene {
  return {
    daemon: DAEMON,
    recorded: undefined,
    text: undefined,
    missing: undefined,
    accepted: true,
    dialogs: [],
    queries: [],
    sink: new MemorySink(),
  };
}

function requestOf(
  stage: RequirementsRequest['stage'],
  merged?: HostRequirements,
): RequirementsRequest {
  return {base: '/w/p', folder: '/w/p', configFile: FILE, stage, merged};
}

describe('the step of the host requirements (card containers-202, F-0206)', () => {
  it('F-0206 BR-1, AC-3: requirements the daemon meets show no dialog', async () => {
    const scene = sceneOf();
    const accepted = await hostRequirementsAccepted(
      portsOf(scene),
      requestOf('merged', {cpus: 4, needsGpu: false}),
      NEVER,
    );
    deepStrictEqual([accepted, scene.dialogs], [true, []]);
  });

  it('F-0206 AC-3, AC-4, AC-5: requirements the daemon does not meet show the dialog with the daemon’s line and the configuration’s, and its answer is the step’s', async () => {
    const accepting = sceneOf();
    const declining = sceneOf();
    declining.accepted = false;
    const request = requestOf('merged', {cpus: 8, needsGpu: false});
    const answers = [
      await hostRequirementsAccepted(portsOf(accepting), request, NEVER),
      await hostRequirementsAccepted(portsOf(declining), request, NEVER),
    ];
    deepStrictEqual(
      [answers, accepting.dialogs],
      [
        [true, false],
        [
          [
            'Not all host requirements in devcontainer.json are met by the Docker daemon.',
            'Docker daemon: CPUs 4, RAM 16gb\ndevcontainer.json: CPUs 8',
            'Continue',
          ],
        ],
      ],
    );
  });

  it('F-0206 AC-6, BR-10: nothing is remembered: the same requirements show the dialog again', async () => {
    const scene = sceneOf();
    const request = requestOf('merged', {cpus: 8, needsGpu: false});
    await hostRequirementsAccepted(portsOf(scene), request, NEVER);
    await hostRequirementsAccepted(portsOf(scene), request, NEVER);
    deepStrictEqual(scene.dialogs.length, 2);
  });

  it('F-0206 BR-17: stage one reads the file’s own text and not the merged requirements, and reads no other file', async () => {
    const scene = sceneOf();
    scene.text = '{ "hostRequirements": { "cpus": 64 } }';
    await hostRequirementsAccepted(
      portsOf(scene),
      requestOf('file', {cpus: 1, needsGpu: false}),
      NEVER,
    );
    deepStrictEqual(
      [scene.dialogs.map(dialog => dialog[1]), scene.queries],
      [
        ['Docker daemon: CPUs 4, RAM 16gb\ndevcontainer.json: CPUs 64'],
        [
          'daemonFigures /w/p',
          `readText ${FILE}`,
          `containerRequirements ${FILE}`,
        ],
      ],
    );
  });

  it('F-0206 AC-24, AC-36, BR-13, BR-18: the label of an existing container adds its requirements, and the larger wins', async () => {
    const scene = sceneOf();
    scene.recorded = {cpus: 16, needsGpu: false};
    await hostRequirementsAccepted(
      portsOf(scene),
      requestOf('merged', {cpus: 2, needsGpu: false}),
      NEVER,
    );
    deepStrictEqual(
      scene.dialogs.map(dialog => dialog[1]),
      ['Docker daemon: CPUs 4, RAM 16gb\ndevcontainer.json: CPUs 16'],
    );
  });

  it('F-0206 AC-27, BR-13: a GPU that only the label requires is listed when the CPUs are unmet', async () => {
    const scene = sceneOf();
    scene.recorded = {needsGpu: true};
    await hostRequirementsAccepted(
      portsOf(scene),
      requestOf('merged', {cpus: 8, needsGpu: false}),
      NEVER,
    );
    deepStrictEqual(
      scene.dialogs.map(dialog => dialog[1]),
      ['Docker daemon: CPUs 4, RAM 16gb\ndevcontainer.json: CPUs 8, GPU'],
    );
  });

  it('F-0206 BR-13, reading-2146-requirements-lookup: with no merged requirements the file is read instead, and the fallback is logged', async () => {
    const scene = sceneOf();
    scene.text = '{ "hostRequirements": { "memory": "64gb" } }';
    const accepted = await hostRequirementsAccepted(
      portsOf(scene),
      requestOf('merged'),
      NEVER,
    );
    deepStrictEqual(
      [
        accepted,
        scene.dialogs.map(dialog => dialog[1]),
        scene.sink.lines.map(line => line.message),
      ],
      [
        true,
        ['Docker daemon: CPUs 4, RAM 16gb\ndevcontainer.json: RAM 64gb'],
        [
          'the merged configuration gave no host requirements; the configuration file is read instead',
          'the Docker daemon does not meet the host requirements: Docker daemon: CPUs 4, RAM 16gb; devcontainer.json: RAM 64gb',
        ],
      ],
    );
  });

  it('F-0206 BR-13: with no merged requirements and an image the engine does not hold, the step logs why and checks nothing; a local image, and a build or Compose configuration, keep the file fallback', async () => {
    async function outcomeOf(text: string, missing: string | undefined) {
      const scene = sceneOf();
      scene.text = text;
      scene.missing = missing;
      const accepted = await hostRequirementsAccepted(
        portsOf(scene),
        requestOf('merged'),
        NEVER,
      );
      return [
        accepted,
        scene.dialogs.length,
        scene.sink.lines.map(line => line.message).slice(0, 1),
        scene.queries.filter(query => query.startsWith('imageMissing')),
      ];
    }
    const asks = '"hostRequirements": {"cpus": 64}';
    const fallback = [
      'the merged configuration gave no host requirements; the configuration file is read instead',
    ];
    deepStrictEqual(
      [
        await outcomeOf(
          `{"image": "r/i:1", ${asks}}`,
          'Error: No such image: r/i:1',
        ),
        await outcomeOf(`{"image": "r/i:1", ${asks}}`, undefined),
        await outcomeOf(`{"build": {"dockerfile": "D"}, ${asks}}`, 'gone'),
        await outcomeOf(`{"image": "r/i:1", "build": {}, ${asks}}`, 'gone'),
        await outcomeOf(
          `{"image": "r/i:1", "dockerComposeFile": "c.yml", ${asks}}`,
          'gone',
        ),
      ],
      [
        [
          true,
          0,
          [
            'the image could not be pulled before the host requirements check: Error: No such image: r/i:1',
          ],
          ['imageMissing r/i:1'],
        ],
        [true, 1, fallback, ['imageMissing r/i:1']],
        [true, 1, fallback, []],
        [true, 1, fallback, []],
        [true, 1, fallback, []],
      ],
    );
  });

  it('F-0206 BR-1: a file that can’t be read asks nothing, and a daemon whose figures can’t be read is not checked, with a log line', async () => {
    const unreadable = sceneOf();
    const blind = sceneOf();
    blind.daemon = undefined;
    const answers = [
      await hostRequirementsAccepted(
        portsOf(unreadable),
        requestOf('file'),
        NEVER,
      ),
      await hostRequirementsAccepted(
        portsOf(blind),
        requestOf('merged', {cpus: 64, needsGpu: false}),
        NEVER,
      ),
    ];
    deepStrictEqual(
      [answers, unreadable.dialogs, blind.dialogs, blind.sink.lines.length],
      [[true, true], [], [], 1],
    );
  });
});
