/**
 * @fileoverview The agent's shipped defaults: the relay's domain and the GitHub app it signs in with, in the
 * `config.json` that sits beside the agent's code. The release build writes the file; the agent only reads it.
 */

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

/** The agent's shipped defaults. */
export interface AgentConfig {
  /** The relay's domain: its management service is `https://cp.<domain>/`. */
  domain: string;
  /** The public id of the GitHub app the agent signs in with. */
  githubClientId: string;
}

/** A configuration file the agent can't use, named by its path. */
export class ConfigError extends Error {}

/** The text `fields` holds under `key`; a missing or empty one fails, naming the file `where`. */
function requiredText(
  fields: Record<string, unknown>,
  key: keyof AgentConfig,
  where: string,
): string {
  const held = fields[key];
  if (typeof held !== 'string' || held === '') {
    throw new ConfigError(`${where} has no ${key}`);
  }
  return held;
}

/**
 * The defaults in `config.json` one folder above `codeFolder`, the folder of the agent's code: `lib/` in the archive,
 * `src/` in the repository. A missing file, one that isn't JSON, or one with a key missing or empty fails with the
 * file's path.
 */
export function readConfig(codeFolder: URL): AgentConfig {
  const file = new URL('../config.json', codeFolder);
  const where = fileURLToPath(file);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (caught) {
    // Reading the file and parsing it throw only errors.
    throw new ConfigError(
      `${where} can't be read as JSON: ${(caught as Error).message}`,
    );
  }
  const fields = (
    typeof value === 'object' && value !== null ? value : {}
  ) as Record<string, unknown>;
  return {
    domain: requiredText(fields, 'domain', where),
    githubClientId: requiredText(fields, 'githubClientId', where),
  };
}
