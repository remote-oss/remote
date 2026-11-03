/**
 * @fileoverview The Docker Compose model of a configuration: Compose's own `config`
 * output, which is the merged model Compose will build and start, read once per connect through C2 and parsed with
 * `yaml`. The output is read from stdout and never logged: Compose interpolates the `.env` files and the environment
 * into it, secrets included .
 */

import type {Logger} from 'lib-log';
import {parse} from 'yaml';
import type {EngineOptions, EngineRunOutcome} from '../engine/engine-host.ts';

/** What the model needs from outside: Compose through C2, and the client's files. */
export interface ComposeModelPorts {
  /** Runs Compose with `argv`, the arguments after its program, with the editor's environment. */
  runCompose(
    argv: readonly string[],
    options: EngineOptions,
  ): Promise<EngineRunOutcome>;
  /** The text of a file of the client; it rejects when the file cannot be read. */
  readText(file: string): Promise<string>;
  logger: Logger;
}

/** What is asked of the model. */
export interface ComposeModelRequest {
  /** The configuration's compose files, absolute and in order; none for `"dockerComposeFile": []` (6.4a). */
  files: readonly string[];
  /** The workspace folder: Compose finds its default files and its `.env` there when the configuration names no file. */
  workspaceFolder: string;
  cancellation: AbortSignal;
}

/** A service as the project needs it: the Dockerfile it builds from, and its volumes as Compose resolved them. */
interface ComposeService {
  build: {context: string; dockerfile: string | undefined} | undefined;
  volumes: readonly unknown[];
}

/** The model of a project. */
export interface ComposeModel {
  /** The `name` Compose resolved; its own default when no file declares one. */
  resolvedName: string | undefined;
  /** The top-level `name:` of the last compose file that declares one. */
  declaredName: string | undefined;
  /** The services of the active profiles, in the order of the output. */
  services: ReadonlyMap<string, ComposeService>;
}

/** The model, or why Compose would not give one. */
export type ComposeModelRead =
  {kind: 'model'; model: ComposeModel} | {kind: 'rejected'; detail: string};

/** The value as a mapping, or none for any other YAML value. */
function mappingOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The service Compose printed: its build and its volumes. */
function serviceOf(definition: unknown): ComposeService {
  const fields = mappingOf(definition) ?? {};
  const {build} = fields;
  const buildFields = mappingOf(build);
  return {
    build:
      typeof build === 'string'
        ? {context: build, dockerfile: undefined}
        : buildFields === undefined
          ? undefined
          : {
              context:
                typeof buildFields.context === 'string'
                  ? buildFields.context
                  : '.',
              dockerfile:
                typeof buildFields.dockerfile === 'string'
                  ? buildFields.dockerfile
                  : undefined,
            },
    volumes: Array.isArray(fields.volumes) ? (fields.volumes as unknown[]) : [],
  };
}

/** The first line of `text`, or `fallback` when there is none. */
function firstLineOf(text: string, fallback: string): string {
  const line = text.split('\n', 1).join('').trim();
  return line === '' ? fallback : line;
}

/** The arguments of `config` for the configuration's files. */
function configArguments(request: ComposeModelRequest): string[] {
  return request.files.length === 0
    ? ['--project-directory', request.workspaceFolder, 'config']
    : [...request.files.flatMap(file => ['-f', file]), 'config'];
}

/** The top-level `name:` of the last file that declares one; a file that cannot be read or parsed declares none. */
async function declaredNameOf(
  ports: ComposeModelPorts,
  files: readonly string[],
): Promise<string | undefined> {
  let declared: string | undefined;
  for (const file of files) {
    try {
      const {name} = mappingOf(parse(await ports.readText(file))) ?? {};
      if (typeof name === 'string') {
        declared = name;
      }
    } catch {
      ports.logger.debug(`could not read a top-level name from ${file}`);
    }
  }
  return declared;
}

/** Reads the model of the configuration's Compose project. */
export async function composeModelOf(
  ports: ComposeModelPorts,
  request: ComposeModelRequest,
): Promise<ComposeModelRead> {
  const {logger} = ports;
  const outcome = await ports.runCompose(configArguments(request), {
    cancellation: request.cancellation,
  });
  if (outcome.kind === 'failed') {
    logger.warn(`could not run Compose: ${outcome.detail}`);
    return {kind: 'rejected', detail: outcome.detail};
  }
  if (outcome.status !== 0) {
    // Compose's own error is safe to log; its output on success is not.
    logger.warn(
      `Compose config ended with status ${String(outcome.status)}: ${outcome.stderr.trim()}`,
    );
    return {
      kind: 'rejected',
      detail: firstLineOf(
        outcome.stderr,
        `Compose ended with status ${String(outcome.status)}`,
      ),
    };
  }
  let output: Record<string, unknown> | undefined;
  try {
    output = mappingOf(parse(outcome.stdout));
  } catch {
    // The parser's message quotes the text it failed on, which is not for the log.
    logger.warn('the output of Compose config is not YAML');
    return {kind: 'rejected', detail: 'the output of Compose is not YAML'};
  }
  const services = mappingOf(output?.services);
  if (output === undefined || services === undefined) {
    logger.warn('the output of Compose config has no services');
    return {kind: 'rejected', detail: 'the model has no services'};
  }
  logger.info(
    `read the Compose model: ${String(Object.keys(services).length)} services`,
  );
  return {
    kind: 'model',
    model: {
      resolvedName: typeof output.name === 'string' ? output.name : undefined,
      declaredName: await declaredNameOf(ports, request.files),
      services: new Map(
        Object.entries(services).map(([name, definition]) => [
          name,
          serviceOf(definition),
        ]),
      ),
    },
  };
}
