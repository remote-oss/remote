/**
 * @fileoverview What a connect knows of a Compose configuration before the dev container CLI runs: its model from Compose, its project name and its scope. A configuration that is not a Compose one gives nothing,
 * and goes on as an image or a Dockerfile.
 */

import path from 'node:path';
import {parseConfiguration} from '../config/configuration-text.ts';
import {
  type ComposeModel,
  type ComposeModelPorts,
  composeModelOf,
} from './model.ts';
import {projectNameOf} from './project-name.ts';
import {projectSourcesOf} from './project-sources.ts';
import {composeScopeOf} from './scope.ts';

/** What the resolver needs from outside. */
export interface ComposeResolverPorts extends ComposeModelPorts {
  /** The editor's environment. */
  environment: Readonly<Record<string, string | undefined>>;
}

/** What the resolver is asked about. */
export interface ComposeResolveRequest {
  workspaceFolder: string;
  configFile: string;
  cancellation: AbortSignal;
}

/** What the resolver found. */
export type ComposeResolution =
  | {kind: 'none'}
  | {
      kind: 'ready';
      projectName: string;
      service: string;
      scope: readonly string[];
      model: ComposeModel;
    }
  | {kind: 'failed'; detail: string};

/** The compose files of a configuration, absolute: the string or the list of strings `dockerComposeFile` holds. */
function composeFilesOf(
  value: unknown,
  configFolder: string,
): string[] | undefined {
  const names: unknown = typeof value === 'string' ? [value] : value;
  return Array.isArray(names) && names.every(name => typeof name === 'string')
    ? names.map((name: string) => path.resolve(configFolder, name))
    : undefined;
}

/** Whether the CLI would build the configuration from an image or a Dockerfile in spite of its compose file. */
function namesNonComposeSource(
  configuration: Record<string, unknown>,
): boolean {
  const {build} = configuration;
  return (
    'image' in configuration ||
    'dockerFile' in configuration ||
    (typeof build === 'object' &&
      build !== null &&
      !Array.isArray(build) &&
      'dockerfile' in build)
  );
}

/** The services `runServices` names, when it is a list of names. */
function runServicesOf(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(name => typeof name === 'string')
    ? value
    : undefined;
}

/** The resolver over its ports. */
export function composeResolverOf(
  ports: ComposeResolverPorts,
): (request: ComposeResolveRequest) => Promise<ComposeResolution> {
  return async request => {
    const text = await ports.readText(request.configFile).catch(() => '');
    const configuration = parseConfiguration(text);
    const files = composeFilesOf(
      configuration?.dockerComposeFile,
      path.dirname(request.configFile),
    );
    const service = configuration?.service;
    if (
      configuration === undefined ||
      files === undefined ||
      typeof service !== 'string' ||
      namesNonComposeSource(configuration)
    ) {
      return {kind: 'none'};
    }
    const read = await composeModelOf(ports, {
      files,
      workspaceFolder: request.workspaceFolder,
      cancellation: request.cancellation,
    });
    if (read.kind === 'rejected') {
      return {kind: 'failed', detail: read.detail};
    }
    const name = projectNameOf(
      await projectSourcesOf(ports, {
        workspaceFolder: request.workspaceFolder,
        files,
        declaredName: read.model.declaredName,
        dashAndUnderscore: true,
      }),
    );
    if (name.kind === 'invalid') {
      ports.logger.warn(
        `the Compose project name from ${name.source} is not valid: "${name.value}"`,
      );
      return {
        kind: 'failed',
        detail: `the project name "${name.value}" is not valid`,
      };
    }
    ports.logger.info(`the Compose project is ${name.name}`);
    return {
      kind: 'ready',
      projectName: name.name,
      service,
      scope: composeScopeOf({
        service,
        runServices: runServicesOf(configuration.runServices),
        modelServices: [...read.model.services.keys()],
      }),
      model: read.model,
    };
  };
}
