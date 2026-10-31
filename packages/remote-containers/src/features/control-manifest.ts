/**
 * @fileoverview The control manifest of the dev container specification: the Features it disallows, read before a
 * reload so that a problematic Feature is refused while the window is still local. The manifest is downloaded in the
 * extension host (core's proxy applies) and kept for five minutes; a failed download uses the kept copy, or an empty
 * manifest when there is none.
 */

import type {Logger} from 'lib-log';
import {harnessUrlOf} from '../acceptance-switch.ts';
import {isRecord} from '../extensions/extension-list.ts';
import {linkedAbort} from '../linked-abort.ts';
import {filled} from '../surfaces/filled.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';

/** Where the published manifest is. */
export const CONTROL_MANIFEST_URL =
  'https://containers.dev/static/devcontainer-control-manifest.json';

/** The variable that names the harness's own manifest; it counts only while the switch is on. */
const MANIFEST_VARIABLE = 'REMOTE_OSS_CONTROL_MANIFEST';

/** How long a kept copy is used without downloading again, in milliseconds. */
export const MANIFEST_CACHE_MILLISECONDS = 300_000;

/** How long the download may take before it counts as failed, in milliseconds. */
export const MANIFEST_FETCH_MILLISECONDS = 10_000;

/** The log line of a failed download; the string id is `S177`. */
const FETCH_FAILED_TEMPLATE = 'Failed to fetch control manifest: {0}';

/** One Feature the manifest disallows. */
export interface DisallowedFeature {
  /** The Feature id, or the start of the ids, that is disallowed. */
  featureIdPrefix: string;
  /** Where the user reads why; none when the entry gives none. */
  documentationURL?: string;
}

/** What the product reads of the manifest. */
export interface ControlManifest {
  disallowedFeatures: readonly DisallowedFeature[];
}

/** The manifest to download: the harness's own when the switch is on and it names one, else the published one. */
export function controlManifestUrlOf(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  return harnessUrlOf(environment, MANIFEST_VARIABLE, CONTROL_MANIFEST_URL);
}

/** The manifest of a text; none when the text is no JSON. An entry without a text prefix is skipped. */
export function parseControlManifest(
  text: string,
): ControlManifest | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const entries =
    isRecord(parsed) && Array.isArray(parsed.disallowedFeatures)
      ? (parsed.disallowedFeatures as unknown[])
      : [];
  return {
    disallowedFeatures: entries.flatMap(entry => {
      if (!isRecord(entry) || typeof entry.featureIdPrefix !== 'string') {
        return [];
      }
      return [
        {
          featureIdPrefix: entry.featureIdPrefix,
          ...(typeof entry.documentationURL === 'string'
            ? {documentationURL: entry.documentationURL}
            : {}),
        },
      ];
    }),
  };
}

/** The characters after a prefix that still make the id the Feature's own: `/`, `:` or `@`. */
const CONTINUATIONS = ['/', ':', '@'];

/** The entry that disallows `featureId`: an id equal to the entry's prefix, or continuing it with `/`, `:` or `@`. */
export function disallowedEntryOf(
  manifest: ControlManifest,
  featureId: string,
): DisallowedFeature | undefined {
  return manifest.disallowedFeatures.find(
    entry =>
      featureId === entry.featureIdPrefix ||
      CONTINUATIONS.some(continuation =>
        featureId.startsWith(entry.featureIdPrefix + continuation),
      ),
  );
}

/** What the manifest needs of its surroundings. */
export interface ControlManifestPorts {
  environment: Readonly<Record<string, string | undefined>>;
  /** The text at `url`; it rejects with the cause in its message, and ends when `cancellation` aborts. */
  download(url: string, cancellation: AbortSignal): Promise<string>;
  /** The kept copy: its text and when it was kept, in milliseconds; none when there is none. */
  kept(): {text: string; keptAt: number} | undefined;
  keep(text: string, keptAt: number): void;
  now(): number;
  /** Runs `callback` once after `milliseconds`; the result cancels it. */
  setTimer(milliseconds: number, callback: () => void): () => void;
  translate: Translate;
  logger: Logger;
}

/** The manifest to check the Features against: fresh from the kept copy, else downloaded, else the kept copy, else empty. */
export async function controlManifestOf(
  ports: ControlManifestPorts,
  cancellation: AbortSignal,
): Promise<ControlManifest> {
  const kept = ports.kept();
  const keptManifest =
    kept === undefined ? undefined : parseControlManifest(kept.text);
  if (
    kept !== undefined &&
    keptManifest !== undefined &&
    ports.now() - kept.keptAt < MANIFEST_CACHE_MILLISECONDS
  ) {
    return keptManifest;
  }
  const {own, release} = linkedAbort(cancellation);
  const state = {timedOut: false};
  const stop = ports.setTimer(MANIFEST_FETCH_MILLISECONDS, () => {
    state.timedOut = true;
    own.abort();
  });
  try {
    const text = await ports.download(
      controlManifestUrlOf(ports.environment),
      own.signal,
    );
    const manifest = parseControlManifest(text);
    if (manifest === undefined) {
      throw new Error('the manifest is no JSON');
    }
    ports.keep(text, ports.now());
    return manifest;
  } catch (caught) {
    if (cancellation.aborted) {
      return keptManifest ?? {disallowedFeatures: []};
    }
    ports.logger.warn(
      filled(ports.translate, FETCH_FAILED_TEMPLATE, [
        state.timedOut
          ? 'the download timed out'
          : caught instanceof Error
            ? caught.message
            : String(caught),
      ]),
    );
    if (kept !== undefined && keptManifest !== undefined) {
      ports.keep(kept.text, ports.now());
    }
    return keptManifest ?? {disallowedFeatures: []};
  } finally {
    stop();
    release();
  }
}
