/**
 * @fileoverview The first steps of a clone's resolve: the volume, created if absent, and a fresh bootstrap container
 * with the volume mounted, which must have the tools the clone and `up` need. Every step is an engine call read by its
 * exit status; a container started here is removed again if a later step fails.
 */

import type {Logger} from 'lib-log';
import {
  BOOTSTRAP_TOOLS,
  type BootstrapSettings,
  type BootstrapTool,
  bootstrapRemoveArguments,
  bootstrapRunArguments,
  imageArgumentsOf,
  toolCheckArguments,
  toolCheckLineOf,
  toolCheckOutcomeOf,
} from './bootstrap.ts';
import {volumeCreateArguments, volumeInspectArguments} from './clone-volume.ts';
import {type EngineStepPorts, type StepResult, stepOf} from './engine-step.ts';

/** A temporary build context that holds our Dockerfile and the bundled CLI. */
export interface BuildContext {
  folder: string;
  dispose(): Promise<void>;
}

/** What the start needs of the engine and the host. */
export interface BootstrapStartPorts extends EngineStepPorts {
  /** Writes a fresh build context for our image; called only when the built-in image is used. */
  buildContext(): Promise<BuildContext>;
  logger: Logger;
}

/** The volume to clone into: its name, and the labels it gets if it has to be created. */
export interface VolumeRequest {
  name: string;
  labels: readonly string[];
}

/** How the start ended: a running container, a required tool missing, or an engine step that failed. */
export type BootstrapStart =
  | {kind: 'started'; container: string}
  | {kind: 'missingTool'; reason: 'S344' | 'S345'}
  | {kind: 'engineFailed'; detail: string};

/** Creates the volume unless it exists; an existing volume keeps the labels it was created with. */
async function ensureVolume(
  ports: BootstrapStartPorts,
  volume: VolumeRequest,
): Promise<StepResult> {
  const inspected = await stepOf(ports, volumeInspectArguments(volume.name));
  if (inspected.succeeded) {
    ports.logger.info(`the volume ${volume.name} exists already`);
    return inspected;
  }
  return stepOf(ports, volumeCreateArguments(volume.name, volume.labels));
}

/** Makes the image ready: our own built from a fresh context, or a custom one, pulled when its setting asks. */
async function readyImage(
  ports: BootstrapStartPorts,
  settings: BootstrapSettings,
): Promise<
  {succeeded: true; image: string} | {succeeded: false; detail: string}
> {
  const context =
    settings.image === '' ? await ports.buildContext() : undefined;
  try {
    const {image, calls} = imageArgumentsOf(settings, context?.folder ?? '');
    for (const call of calls) {
      const result = await stepOf(ports, call);
      if (!result.succeeded) {
        return result;
      }
    }
    return {succeeded: true, image};
  } finally {
    await context?.dispose();
  }
}

/** Looks for each tool in order; an engine that can't run the check fails it. */
async function toolsFound(
  ports: BootstrapStartPorts,
  container: string,
): Promise<
  | {succeeded: true; found: Set<BootstrapTool>}
  | {succeeded: false; detail: string}
> {
  const found = new Set<BootstrapTool>();
  for (const tool of BOOTSTRAP_TOOLS) {
    const outcome = await ports.engine.run(
      toolCheckArguments(container, tool),
      {kind: 'none'},
      ports.options,
    );
    if (outcome.kind === 'failed') {
      return {succeeded: false, detail: outcome.detail};
    }
    if (outcome.status === 0) {
      found.add(tool);
    }
  }
  return {succeeded: true, found};
}

/** Removes a container this start made; its outcome is only logged. */
async function removeContainer(
  ports: BootstrapStartPorts,
  container: string,
): Promise<void> {
  const removed = await stepOf(ports, bootstrapRemoveArguments(container));
  ports.logger.info(
    removed.succeeded
      ? 'the bootstrap container was removed'
      : `the bootstrap container could not be removed: ${removed.detail}`,
  );
}

/** Checks the tools of a started container, and removes it when the check doesn't pass. */
async function checkedContainer(
  ports: BootstrapStartPorts,
  container: string,
): Promise<BootstrapStart> {
  const tools = await toolsFound(ports, container);
  if (!tools.succeeded) {
    await removeContainer(ports, container);
    return {kind: 'engineFailed', detail: tools.detail};
  }
  ports.logger.info(toolCheckLineOf(tools.found));
  const outcome = toolCheckOutcomeOf(tools.found);
  if (outcome.kind === 'ok') {
    return {kind: 'started', container};
  }
  await removeContainer(ports, container);
  return {kind: 'missingTool', reason: outcome.reason};
}

/** Prepares the volume and starts a checked bootstrap container on it, with the settings read for this start. */
export async function startBootstrap(
  ports: BootstrapStartPorts,
  volume: VolumeRequest,
  settings: BootstrapSettings,
): Promise<BootstrapStart> {
  const volumeReady = await ensureVolume(ports, volume);
  if (!volumeReady.succeeded) {
    return {kind: 'engineFailed', detail: volumeReady.detail};
  }
  const image = await readyImage(ports, settings);
  if (!image.succeeded) {
    return {kind: 'engineFailed', detail: image.detail};
  }
  const started = await stepOf(
    ports,
    bootstrapRunArguments(image.image, volume.name, settings.socketPath),
  );
  if (!started.succeeded) {
    return {kind: 'engineFailed', detail: started.detail};
  }
  return checkedContainer(ports, started.stdout.trim());
}
