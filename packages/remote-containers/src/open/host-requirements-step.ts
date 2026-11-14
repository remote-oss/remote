/**
 * @fileoverview The pre-reload step that tells the user when the Docker daemon has fewer CPUs or less memory than the
 * chosen configuration asks for. Stage one reads the configuration file's own text, for commands whose workspace is not
 * trusted yet and that therefore read nothing the configuration names; stage two takes the merged configuration the
 * CLI gave. Either stage adds what the label of the folder's existing container records. When the daemon's figures cannot
 * be read, or the merged read gave none, the step reads the file and goes on; when the merged read gave none because an
 * image configuration's image is not in the engine's store (the CLI's pull failed), the step logs why and checks
 * nothing. "Continue" goes on unchanged, with no limit applied; "Cancel" ends the command.
 */

import type {Logger} from 'lib-log';
import {parseConfiguration} from '../config/configuration-text.ts';
import {
  type DaemonFigures,
  type HostRequirements,
  mergedRequirements,
  requirementsOfText,
  unmetDetail,
} from '../engine/host-requirements.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';

/** The English templates of the dialog. */
const REQUIREMENTS_TEMPLATES = {
  S244: 'Not all host requirements in devcontainer.json are met by the Docker daemon.',
  S092: 'Continue',
} as const;

/** Which reading of the requirements the step makes. */
type RequirementsStage = 'file' | 'merged';

/** What the step needs of the engine, the file system and the editor. */
export interface HostRequirementsPorts {
  /** What the daemon has; none when it can't be read. */
  daemonFigures(
    base: string | undefined,
    cancellation: AbortSignal,
  ): Promise<DaemonFigures | undefined>;
  /** What the label of the container made for the folder and the configuration records; none when there is none. */
  containerRequirements(
    base: string | undefined,
    identity: {folder: string; configFile: string},
    cancellation: AbortSignal,
  ): Promise<HostRequirements | undefined>;
  /** Why `image` is not in the engine's local store; none when it is local or the engine can't say. */
  imageMissing(
    base: string | undefined,
    image: string,
    cancellation: AbortSignal,
  ): Promise<string | undefined>;
  /** The text of the configuration file; none when it can't be read. */
  readText(file: string): Promise<string | undefined>;
  /** The modal dialog with `message` and `detail`, whose primary button is `acceptLabel` and whose other is Cancel; whether the user accepted. */
  confirm(
    message: string,
    detail: string,
    acceptLabel: string,
  ): Promise<boolean>;
  translate: Translate;
  logger: Logger;
}

/** A command's check of the host requirements: which reading it makes, and what the step needs. */
export interface HostRequirementsCheck {
  stage: RequirementsStage;
  ports: HostRequirementsPorts;
  /** The folder a relative `dockerPath` is resolved against; none while the workspace is not trusted. */
  base: string | undefined;
}

/** What the step is asked about. */
export interface RequirementsRequest {
  base: string | undefined;
  folder: string;
  configFile: string;
  stage: RequirementsStage;
  /** What the merged configuration asks; none when the read was not merged. */
  merged: HostRequirements | undefined;
}

/** The image of a configuration that names one and builds nothing: not a `build` or Compose configuration. */
function imageOf(text: string): string | undefined {
  const parsed = parseConfiguration(text);
  return typeof parsed?.image === 'string' &&
    parsed.build === undefined &&
    parsed.dockerComposeFile === undefined
    ? parsed.image
    : undefined;
}

/** What the configuration asks, by the stage's reading; the file's own text when the merged one is missing. */
async function askedOf(
  ports: HostRequirementsPorts,
  request: RequirementsRequest,
  cancellation: AbortSignal,
): Promise<HostRequirements | {unpulled: string}> {
  if (request.stage === 'merged' && request.merged !== undefined) {
    return request.merged;
  }
  const text = await ports.readText(request.configFile);
  if (request.stage === 'merged' && text !== undefined) {
    const image = imageOf(text);
    const reason =
      image === undefined
        ? undefined
        : await ports.imageMissing(request.base, image, cancellation);
    if (reason !== undefined) {
      return {unpulled: reason};
    }
  }
  if (request.stage === 'merged') {
    ports.logger.debug(
      'the merged configuration gave no host requirements; the configuration file is read instead',
    );
  }
  return text === undefined ? {needsGpu: false} : requirementsOfText(text);
}

/** Whether the command goes on: the requirements are met, or the user chose to continue. */
export async function hostRequirementsAccepted(
  ports: HostRequirementsPorts,
  request: RequirementsRequest,
  cancellation: AbortSignal,
): Promise<boolean> {
  const daemon = await ports.daemonFigures(request.base, cancellation);
  if (daemon === undefined) {
    ports.logger.info(
      "the Docker daemon's figures could not be read; the host requirements are not checked",
    );
    return true;
  }
  const [asked, recorded] = await Promise.all([
    askedOf(ports, request, cancellation),
    ports.containerRequirements(request.base, request, cancellation),
  ]);
  if ('unpulled' in asked) {
    ports.logger.info(
      `the image could not be pulled before the host requirements check: ${asked.unpulled}`,
    );
    return true;
  }
  const detail = unmetDetail(
    mergedRequirements([asked, recorded ?? {needsGpu: false}]),
    daemon,
    ports.translate,
  );
  if (detail === undefined) {
    return true;
  }
  ports.logger.info(
    `the Docker daemon does not meet the host requirements: ${detail.replace('\n', '; ')}`,
  );
  return ports.confirm(
    ports.translate(REQUIREMENTS_TEMPLATES.S244),
    detail,
    ports.translate(REQUIREMENTS_TEMPLATES.S092),
  );
}
