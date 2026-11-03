/**
 * @fileoverview What a connect knows of a Compose configuration before the dev container CLI runs: its model from Compose, its project name and its scope. A configuration that is not a Compose one gives nothing,
 * and goes on as an image or a Dockerfile.
 */

import path from 'node:path';
import {
  composeFileNamesOf,
  isComposeConfiguration,
  parseConfiguration,
} from '../config/configuration-text.ts';
import type {ComposeRoute} from '../engine/compose-route.ts';
import type {EngineOptions, EngineRunOutcome} from '../engine/engine-host.ts';
import {
  type ComposeModel,
  type ComposeModelPorts,
  composeModelOf,
} from './model.ts';
import {projectNameOf} from './project-name.ts';
import {projectSourcesOf} from './project-sources.ts';
import {composeScopeOf} from './scope.ts';

/**
 * BuildKit's file system entitlement, which refuses the Dockerfile the CLI writes outside a service's build context. The
 * build of a trusted configuration may read it; a value the user set stays.
 */
const ENTITLEMENT_VARIABLE = 'BUILDX_BAKE_ENTITLEMENTS_FS';

/** A Compose that can be run. */
type UsableRoute = Extract<ComposeRoute, {kind: 'plugin' | 'standalone'}>;

/** What the resolver needs from outside. */
export interface ComposeResolverPorts extends Omit<
  ComposeModelPorts,
  'runCompose'
> {
  /** The editor's environment. */
  environment: Readonly<Record<string, string | undefined>>;
  /** The Compose to use now for a configuration in `base`. */
  route(base: string, cancellation: AbortSignal): Promise<ComposeRoute>;
  /** Runs Compose by `route` with `argv`, the arguments after its program. */
  runVia(
    route: UsableRoute,
    argv: readonly string[],
    options: EngineOptions,
  ): Promise<EngineRunOutcome>;
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
      /** The program of the second route, which the CLI is told with `--docker-compose-path`; none on the plugin. */
      composeFile: string | undefined;
      /** Variables added to the environment of the CLI's `up` only: the build of a service reads a file the CLI writes. */
      upEnvironment: Readonly<Record<string, string>>;
    }
  | {kind: 'failed'; detail: string};

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
    if (configuration === undefined || !isComposeConfiguration(configuration)) {
      return {kind: 'none'};
    }
    const configFolder = path.dirname(request.configFile);
    const files = (
      composeFileNamesOf(configuration.dockerComposeFile) ?? []
    ).map(name => path.resolve(configFolder, name));
    const service = configuration.service as string;
    const route = await ports.route(
      request.workspaceFolder,
      request.cancellation,
    );
    if (route.kind === 'missing' || route.kind === 'broken') {
      return {
        kind: 'failed',
        detail: `Docker Compose cannot be run: ${route.written}`,
      };
    }
    const read = await composeModelOf(
      {
        ...ports,
        runCompose: (argv, options) => ports.runVia(route, argv, options),
      },
      {
        files,
        workspaceFolder: request.workspaceFolder,
        cancellation: request.cancellation,
      },
    );
    if (read.kind === 'rejected') {
      return {kind: 'failed', detail: read.detail};
    }
    const name = projectNameOf(
      await projectSourcesOf(ports, {
        workspaceFolder: request.workspaceFolder,
        files,
        declaredName: read.model.declaredName,
        dashAndUnderscore: route.kind === 'plugin' || route.dashAndUnderscore,
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
      composeFile: route.kind === 'standalone' ? route.file : undefined,
      upEnvironment:
        ports.environment[ENTITLEMENT_VARIABLE] === undefined
          ? {[ENTITLEMENT_VARIABLE]: '0'}
          : {},
    };
  };
}
