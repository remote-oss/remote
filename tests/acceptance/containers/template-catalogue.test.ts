import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import path from 'node:path';
import {variable} from '../windows/harness.ts';

/** The dev container CLI the package bundles, which the run's templates were published with. */
const BUNDLED_CLI = path.join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'remote-containers',
  'dist',
  'devcontainers-cli',
  'devcontainer.js',
);

/** The files `templates apply` of `templateId` with `templateArgs` writes into a new folder of the run, as it reports them. */
function appliedFiles(
  templateId: string,
  templateArgs: Readonly<Record<string, string>>,
): unknown {
  const folder = mkdtempSync(
    path.join(variable('HARNESS_RUN_FOLDER'), 'template-apply-'),
  );
  const applied = spawnSync(
    process.execPath,
    [
      BUNDLED_CLI,
      'templates',
      'apply',
      '-w',
      folder,
      '-t',
      templateId,
      '-a',
      JSON.stringify(templateArgs),
    ],
    {encoding: 'utf8'},
  );
  return applied.status === 0
    ? (JSON.parse(applied.stdout) as {files: unknown}).files
    : `exit ${String(applied.status)}: ${applied.stderr}`;
}

describe("the run's template catalogue and registry (card tooling-57)", function () {
  this.timeout(120_000);

  it("#1235: the run's index lists the mirrored templates and the CLI applies one from the run's registry", async () => {
    const registry = variable('HARNESS_TEMPLATE_REGISTRY');
    const index = (await (
      await fetch(variable('REMOTE_OSS_TEMPLATE_INDEX'))
    ).json()) as {collections: Array<{templates: Array<{id: string}>}>};
    const templateIds = index.collections.flatMap(collection =>
      collection.templates.map(template => template.id),
    );
    const alpine = `${registry}/devcontainers/templates/alpine`;
    const mini = `${registry}/remote-oss-run/custom/mini`;
    deepStrictEqual(
      [
        templateIds.includes(alpine),
        templateIds.includes(mini),
        appliedFiles(`${alpine}:3`, {imageVariant: '3.22'}),
        appliedFiles(`${mini}:1`, {greeting: 'hi'}),
      ],
      [
        true,
        true,
        ['./.devcontainer/devcontainer.json', './.github/dependabot.yml'],
        ['./.devcontainer/devcontainer.json', './.github/mini.yml'],
      ],
    );
  });
});
