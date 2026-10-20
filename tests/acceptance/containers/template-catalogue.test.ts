import {deepStrictEqual} from 'node:assert';
import {execFile, spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  devContainerFolder,
  devContainersOf,
  variable,
} from '../windows/harness.ts';
import {removeContainers} from '../windows/folder-windows.ts';
import {runTemplatesReady} from '../windows/run-templates.ts';

const execFileAsync = promisify(execFile);

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

/** What `templates apply` of `templateId` with `templateArgs` and `extraArguments` did in a new folder of the run. */
interface Applied {
  folder: string;
  /** The files the CLI reports it wrote, or what it failed with. */
  files: unknown;
}

/** Applies `templateId` with `templateArgs` and `extraArguments` into a new folder of the run, as the CLI reports it. */
function applied(
  templateId: string,
  templateArgs: Readonly<Record<string, string>>,
  extraArguments: readonly string[] = [],
): Applied {
  const folder = mkdtempSync(
    path.join(variable('HARNESS_RUN_FOLDER'), 'template-apply-'),
  );
  const outcome = spawnSync(
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
      ...extraArguments,
    ],
    {encoding: 'utf8'},
  );
  return {
    folder,
    files:
      outcome.status === 0
        ? (JSON.parse(outcome.stdout) as {files: unknown}).files
        : `exit ${String(outcome.status)}: ${outcome.stderr}`,
  };
}

/** The files `templates apply` of `templateId` with `templateArgs` writes into a new folder of the run, as it reports them. */
function appliedFiles(
  templateId: string,
  templateArgs: Readonly<Record<string, string>>,
): unknown {
  return applied(templateId, templateArgs).files;
}

/** The ids of the Features the run's served index lists. */
async function listedFeatureIds(): Promise<string[]> {
  const index = (await (
    await fetch(variable('REMOTE_OSS_TEMPLATE_INDEX'))
  ).json()) as {collections: Array<{features?: Array<{id: string}>}>};
  return index.collections.flatMap(collection =>
    (collection.features ?? []).map(feature => feature.id),
  );
}

describe("the run's template catalogue and registry (card tooling-57)", function () {
  this.timeout(120_000);

  it("#1235: the run's index lists the mirrored templates and the CLI applies one from the run's registry", async () => {
    await runTemplatesReady();
    const registry = variable('HARNESS_TEMPLATE_REGISTRY');
    const index = (await (
      await fetch(variable('REMOTE_OSS_TEMPLATE_INDEX'))
    ).json()) as {collections: Array<{templates?: Array<{id: string}>}>};
    const templateIds = index.collections.flatMap(collection =>
      (collection.templates ?? []).map(template => template.id),
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

  it("#1296: the run's index lists the kept and custom Features, and the CLI applies options-lab with arguments, omitted paths and a Feature", async () => {
    await runTemplatesReady();
    const registry = variable('HARNESS_TEMPLATE_REGISTRY');
    const featureIds = await listedFeatureIds();
    const optionsLab = applied(
      `${registry}/remote-oss-run/custom/options-lab:1`,
      {
        flavour: 'c',
        channel: 'edge',
        motto: 'm',
        withDocs: 'false',
        withTests: 'true',
        quiet: 'false',
      },
      [
        '--omit-paths',
        '["docs/*"]',
        '-f',
        '[{"id":"ghcr.io/devcontainers/features/git:1","options":{}}]',
      ],
    );
    const configuration = JSON.parse(
      readFileSync(
        path.join(optionsLab.folder, '.devcontainer', 'devcontainer.json'),
        'utf8',
      ),
    ) as {name: string; features: unknown; containerEnv: unknown};
    // A fact the optional-files card needs: whether the template's README.md and NOTES.md reach the project.
    console.log(
      `#1296: README.md written: ${String(existsSync(path.join(optionsLab.folder, 'README.md')))}, NOTES.md written: ${String(existsSync(path.join(optionsLab.folder, 'NOTES.md')))}`,
    );
    deepStrictEqual(
      [
        ['common-utils', 'docker-in-docker', 'git', 'node', 'python'].map(
          name => featureIds.includes(`ghcr.io/devcontainers/features/${name}`),
        ),
        [
          'remote-oss-run/features/lab-options',
          'remote-oss-run/features/lab-plain',
          'remote-oss-community/features/add-community',
          'remote-oss-community/features/add-community-tool',
          'remote-oss-community/features/adobe-community-kit',
        ].map(feature => featureIds.includes(`${registry}/${feature}`)),
        configuration.name,
        configuration.features,
        configuration.containerEnv,
        [
          existsSync(path.join(optionsLab.folder, 'zeta.txt')),
          existsSync(path.join(optionsLab.folder, 'alpha.txt')),
          existsSync(path.join(optionsLab.folder, 'docs')),
        ],
      ],
      [
        [true, true, true, true, true],
        [true, true, true, true, true],
        'Lab c',
        {'ghcr.io/devcontainers/features/git:1': {}},
        {
          FLAVOUR: 'c',
          CHANNEL: 'edge',
          MOTTO: 'm',
          WITH_DOCS: 'false',
          WITH_TESTS: 'true',
          QUIET: 'false',
        },
        [true, true, false],
      ],
    );
  });

  it('#1296: the mirrored Docker-in-Docker template applies with its defaults', async () => {
    await runTemplatesReady();
    const registry = variable('HARNESS_TEMPLATE_REGISTRY');
    deepStrictEqual(
      appliedFiles(
        `${registry}/devcontainers/templates/docker-in-docker:1`,
        {},
      ),
      ['./.devcontainer/devcontainer.json', './.github/dependabot.yml'],
    );
  });

  it("#1296: a Feature the run published builds into a container with its options, from the run's registry", async () => {
    await runTemplatesReady();
    const registry = variable('HARNESS_TEMPLATE_REGISTRY');
    const folder = devContainerFolder('c1296-up', {
      features: {
        [`${registry}/remote-oss-run/features/lab-options:1`]: {level: 'high'},
      },
    });
    try {
      const started = spawnSync(
        process.execPath,
        [BUNDLED_CLI, 'up', '--workspace-folder', folder],
        {encoding: 'utf8'},
      );
      const [container = ''] = await devContainersOf(folder);
      const {stdout} = await execFileAsync('docker', [
        'exec',
        container,
        'cat',
        '/usr/local/share/remote-oss-run/lab-options.env',
      ]);
      deepStrictEqual(
        [
          started.status,
          stdout
            .split('\n')
            .filter(line => ['ENABLED=true', 'LEVEL=high'].includes(line))
            .sort(),
        ],
        [0, ['ENABLED=true', 'LEVEL=high']],
      );
    } finally {
      await removeContainers(folder);
    }
  });
});
