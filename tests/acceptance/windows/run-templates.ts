/**
 * @fileoverview The run's templates for a row that needs them: a row's clean-up removes every container of the run,
 * the registry included, so the row starts the registry again on its port and publishes the templates into it again
 * from the run's cache, before it reads the index or applies a template.
 */

import path from 'node:path';
import {
  ensureRunRegistry,
  SYSTEM_CLOCK,
} from '../../../tools/acceptance-registry.ts';
import {
  ghcrLayer,
  prepareRunTemplates,
} from '../../../tools/acceptance-templates.ts';
import {runCommand} from '../../../tools/command-runner.ts';
import {variable} from './harness.ts';

/** The repository's root, whose cache holds the mirrored layers. */
const ROOT = path.join(import.meta.dirname, '..', '..', '..');

/** Makes sure the run's registry runs and holds the run's templates. */
export async function runTemplatesReady(): Promise<void> {
  const address = variable('HARNESS_REGISTRY');
  const outcome = await ensureRunRegistry(
    runCommand,
    SYSTEM_CLOCK,
    variable('HARNESS_RUN_ID'),
    address,
  );
  if (outcome === 'restarted') {
    await prepareRunTemplates(
      runCommand,
      ROOT,
      variable('HARNESS_RUN_FOLDER'),
      address,
      ghcrLayer,
      undefined,
      variable('HARNESS_DEVCONTAINER_IMAGE'),
    );
  }
}
