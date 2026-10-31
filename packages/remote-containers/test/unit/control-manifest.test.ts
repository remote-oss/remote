import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  CONTROL_MANIFEST_URL,
  type ControlManifestPorts,
  controlManifestOf,
  controlManifestUrlOf,
  disallowedEntryOf,
  MANIFEST_CACHE_MILLISECONDS,
  MANIFEST_FETCH_MILLISECONDS,
  parseControlManifest,
} from '../../src/features/control-manifest.ts';

const NEVER = new AbortController().signal;

const MANIFEST = JSON.stringify({
  disallowedFeatures: [
    {
      featureIdPrefix: 'ghcr.io/owner/features/bad',
      documentationURL: 'https://example.org/bad',
    },
    {featureIdPrefix: 'ghcr.io/owner/features/worse'},
    {documentationURL: 'https://example.org/none'},
    'not an entry',
  ],
});

/** The ports over a download that answers `answer`, a kept copy, and a clock at `now`. */
function sceneOf(options: {
  answer?: () => Promise<string>;
  /** The download never answers, and rejects when it is aborted. */
  hang?: boolean;
  kept?: {text: string; keptAt: number};
  keepFails?: boolean;
  now?: number;
  environment?: Record<string, string | undefined>;
}) {
  const scene = {
    sink: new MemorySink(),
    downloads: [] as string[],
    keeps: [] as Array<[string, number]>,
    timers: [] as Array<{milliseconds: number; fire: () => void}>,
    stopped: 0,
  };
  const ports: ControlManifestPorts = {
    environment: options.environment ?? {},
    download: (url, signal) => {
      scene.downloads.push(url);
      if (options.hang === true) {
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        });
      }
      return (options.answer ?? (() => Promise.resolve(MANIFEST)))();
    },
    kept: () => options.kept,
    keep: (text, keptAt) => {
      if (options.keepFails === true) {
        throw new Error('read-only storage');
      }
      scene.keeps.push([text, keptAt]);
    },
    now: () => options.now ?? 1_000_000,
    setTimer: (milliseconds, callback) => {
      scene.timers.push({milliseconds, fire: callback});
      return () => {
        scene.stopped += 1;
      };
    },
    translate: template => template,
    logger: createLogger(scene.sink, {minimumLevel: () => 'info'}),
  };
  return {scene, ports};
}

describe('the control manifest (card containers-94)', () => {
  it('#1307: the harness manifest counts while REMOTE_OSS_ACCEPTANCE is 1 and the variable is set', () => {
    deepStrictEqual(
      controlManifestUrlOf({
        REMOTE_OSS_ACCEPTANCE: '1',
        REMOTE_OSS_CONTROL_MANIFEST: 'http://127.0.0.1:9/manifest.json',
      }),
      'http://127.0.0.1:9/manifest.json',
    );
  });

  it('#1307: the harness manifest is ignored with the switch unset, 0 or true', () => {
    deepStrictEqual(
      [undefined, '0', 'true'].map(switchValue =>
        controlManifestUrlOf({
          REMOTE_OSS_ACCEPTANCE: switchValue,
          REMOTE_OSS_CONTROL_MANIFEST: 'http://127.0.0.1:9/manifest.json',
        }),
      ),
      [CONTROL_MANIFEST_URL, CONTROL_MANIFEST_URL, CONTROL_MANIFEST_URL],
    );
  });

  it('#1307: the switch with the variable empty or unset gives the published manifest', () => {
    deepStrictEqual(
      [
        controlManifestUrlOf({REMOTE_OSS_ACCEPTANCE: '1'}),
        controlManifestUrlOf({
          REMOTE_OSS_ACCEPTANCE: '1',
          REMOTE_OSS_CONTROL_MANIFEST: '',
        }),
      ],
      [CONTROL_MANIFEST_URL, CONTROL_MANIFEST_URL],
    );
  });

  it('#1307: the entries with a text prefix are read, with or without a documentation address', () => {
    deepStrictEqual(parseControlManifest(MANIFEST), {
      disallowedFeatures: [
        {
          featureIdPrefix: 'ghcr.io/owner/features/bad',
          documentationURL: 'https://example.org/bad',
        },
        {featureIdPrefix: 'ghcr.io/owner/features/worse'},
      ],
    });
  });

  it('#1307: a text that is no JSON is no manifest, and JSON of another shape lists nothing', () => {
    deepStrictEqual(
      [parseControlManifest('{'), parseControlManifest('[]')],
      [undefined, {disallowedFeatures: []}],
    );
  });

  it('#1307: an id equal to a prefix is disallowed', () => {
    const manifest = parseControlManifest(MANIFEST);
    deepStrictEqual(
      manifest &&
        disallowedEntryOf(manifest, 'ghcr.io/owner/features/bad')
          ?.documentationURL,
      'https://example.org/bad',
    );
  });

  it('#1307: an id that continues a prefix with a slash, a colon or an at sign is disallowed', () => {
    const manifest = parseControlManifest(MANIFEST);
    deepStrictEqual(
      ['/sub', ':1', '@sha256:abc'].map(
        continuation =>
          manifest &&
          disallowedEntryOf(
            manifest,
            `ghcr.io/owner/features/bad${continuation}`,
          )?.featureIdPrefix,
      ),
      Array.from({length: 3}, () => 'ghcr.io/owner/features/bad'),
    );
  });

  it('#1307: an id that merely starts with a prefix, or is shorter than it, is not disallowed', () => {
    const manifest = parseControlManifest(MANIFEST);
    deepStrictEqual(
      [
        'ghcr.io/owner/features/badge',
        'ghcr.io/owner/features/ba',
        'ghcr.io/owner/features',
      ].map(featureId => manifest && disallowedEntryOf(manifest, featureId)),
      [undefined, undefined, undefined],
    );
  });

  it('#1307: a kept copy younger than five minutes is used and nothing is downloaded', async () => {
    const {scene, ports} = sceneOf({
      kept: {
        text: MANIFEST,
        keptAt: 1_000_000 - MANIFEST_CACHE_MILLISECONDS + 1,
      },
    });
    const manifest = await controlManifestOf(ports, NEVER);
    deepStrictEqual(
      [manifest.disallowedFeatures.length, scene.downloads],
      [2, []],
    );
  });

  it('#1307: a kept copy of five minutes is downloaded again and the new text is kept', async () => {
    const {scene, ports} = sceneOf({
      kept: {
        text: '{"disallowedFeatures":[]}',
        keptAt: 1_000_000 - MANIFEST_CACHE_MILLISECONDS,
      },
    });
    const manifest = await controlManifestOf(ports, NEVER);
    deepStrictEqual(
      [manifest.disallowedFeatures.length, scene.downloads, scene.keeps],
      [2, [CONTROL_MANIFEST_URL], [[MANIFEST, 1_000_000]]],
    );
  });

  it('#1307: a failed download with a kept copy uses the copy and logs S177 once', async () => {
    const {scene, ports} = sceneOf({
      answer: () => Promise.reject(new Error('offline')),
      kept: {text: MANIFEST, keptAt: 0},
    });
    const manifest = await controlManifestOf(ports, NEVER);
    deepStrictEqual(
      [
        manifest.disallowedFeatures.length,
        scene.sink.lines.map(line => `${line.level}: ${line.message}`),
      ],
      [2, ['warn: Failed to fetch control manifest: offline']],
    );
  });

  it('#1307: a failed download with no kept copy gives an empty manifest, so nothing is disallowed', async () => {
    const {ports} = sceneOf({
      answer: () => Promise.reject(new Error('offline')),
    });
    deepStrictEqual(await controlManifestOf(ports, NEVER), {
      disallowedFeatures: [],
    });
  });

  it('#1307: an answer that is no JSON counts as a failed download', async () => {
    const {scene, ports} = sceneOf({answer: () => Promise.resolve('<html>')});
    await controlManifestOf(ports, NEVER);
    deepStrictEqual(
      [scene.keeps, scene.sink.lines.map(line => line.message)],
      [[], ['Failed to fetch control manifest: the manifest is no JSON']],
    );
  });

  it('#1307: a failure that is no Error is logged by its text', async () => {
    const {ports, scene} = sceneOf({
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a download may reject with anything
      answer: () => Promise.reject('refused'),
    });
    await controlManifestOf(ports, NEVER);
    deepStrictEqual(
      scene.sink.lines.map(line => line.message),
      ['Failed to fetch control manifest: refused'],
    );
  });

  it('#1307: a kept copy that is no JSON is not used, even when fresh', async () => {
    const {scene, ports} = sceneOf({kept: {text: '{', keptAt: 1_000_000}});
    const manifest = await controlManifestOf(ports, NEVER);
    deepStrictEqual(
      [manifest.disallowedFeatures.length, scene.downloads.length],
      [2, 1],
    );
  });

  it('#1307: a download that never answers is a failed fetch after ten seconds: S177, and the kept copy with its time refreshed', async () => {
    const {scene, ports} = sceneOf({
      hang: true,
      kept: {text: MANIFEST, keptAt: 0},
    });
    const running = controlManifestOf(ports, NEVER);
    scene.timers[0]?.fire();
    const manifest = await running;
    deepStrictEqual(
      [
        scene.timers.map(timer => timer.milliseconds),
        manifest.disallowedFeatures.length,
        scene.sink.lines.map(line => line.message),
        scene.keeps,
      ],
      [
        [MANIFEST_FETCH_MILLISECONDS],
        2,
        ['Failed to fetch control manifest: the download timed out'],
        [[MANIFEST, 1_000_000]],
      ],
    );
  });

  it('#1307: a download that never answers with no kept copy gives an empty manifest', async () => {
    const {scene, ports} = sceneOf({hang: true});
    const running = controlManifestOf(ports, NEVER);
    scene.timers[0]?.fire();
    deepStrictEqual(await running, {disallowedFeatures: []});
  });

  it('#1307: a cancel before the ten seconds is a cancel: no S177, and the timer is stopped', async () => {
    const controller = new AbortController();
    const {scene, ports} = sceneOf({hang: true});
    const running = controlManifestOf(ports, controller.signal);
    controller.abort();
    await running;
    deepStrictEqual(
      [scene.sink.lines.length, scene.stopped, scene.keeps],
      [0, 1, []],
    );
  });

  it('#1307: a storage that cannot be written does not fail the fetch: the manifest comes back and the log says why', async () => {
    const {scene, ports} = sceneOf({keepFails: true});
    const manifest = await controlManifestOf(ports, NEVER);
    deepStrictEqual(
      [
        manifest.disallowedFeatures.length,
        scene.sink.lines.map(line => line.message),
      ],
      [2, ['the control manifest could not be kept: read-only storage']],
    );
  });
});
