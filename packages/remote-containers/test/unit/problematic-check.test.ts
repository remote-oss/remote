/**
 * @fileoverview The rows of the problematic-Feature check (card coverage-117): the refusal as it is read by the
 * command, over a manifest that is fetched while the window reloads.
 */

import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  CONTROL_MANIFEST_URL,
  type ControlManifestPorts,
} from '../../src/features/control-manifest.ts';
import {problematicFeatureRefused} from '../../src/features/problematic-check.ts';

const FEATURE = 'ghcr.io/owner/features/bad';

const MANIFEST = JSON.stringify({
  disallowedFeatures: [{featureIdPrefix: FEATURE}],
});

/** The ports of the check: a manifest whose download settles on a microtask after the cancellation, and the modal. */
function sceneOf() {
  const scene = {
    sink: new MemorySink(),
    downloads: [] as string[],
    warns: 0,
    externals: [] as string[],
  };
  const controller = new AbortController();
  const manifest: ControlManifestPorts = {
    environment: {},
    download: url => {
      scene.downloads.push(url);
      return new Promise<string>(resolve => {
        queueMicrotask(() => {
          controller.abort();
          resolve(MANIFEST);
        });
      });
    },
    kept: () => undefined,
    keep: () => undefined,
    now: () => 1_000_000,
    setTimer: () => () => undefined,
    translate: template => template,
    logger: createLogger(scene.sink, {minimumLevel: () => 'info'}),
  };
  return {scene, controller, manifest};
}

describe('the check that refuses a Feature the manifest disallows (card coverage-117)', () => {
  it('coverage-117: a cancellation that lands while the manifest is fetched stops the check, with no modal', async () => {
    const {scene, controller, manifest} = sceneOf();
    const result = await problematicFeatureRefused(
      {
        manifest,
        warn: () => {
          scene.warns += 1;
          return Promise.resolve('cancel');
        },
        openExternal: address => {
          scene.externals.push(address);
          return Promise.resolve();
        },
      },
      [FEATURE],
      controller.signal,
    );
    deepStrictEqual(
      [result, scene.warns, scene.externals, scene.downloads],
      [true, 0, [], [CONTROL_MANIFEST_URL]],
    );
  });
});
