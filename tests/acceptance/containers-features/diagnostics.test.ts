import {deepStrictEqual} from 'node:assert';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow, setUserSetting} from '../windows/folder-windows.ts';
import {closeWindow, devContainerFolder, waitFor} from '../windows/harness.ts';
import {type Problem, problemsOf} from '../windows/renderer.ts';

const S021 =
  'Absolute file paths are not allowed. Local file path must be indicated relative to the devcontainer.json.';
const S121 = 'Direct tarball references must be served over HTTPS.';
const S179 = 'Failed to parse feature identifier.';
const S195 = 'GitHub release feature id contains invalid characters';
const S246 = 'OCI Feature id contains invalid characters';
const S220 =
  'Legacy feature not supported. Please check https://containers.dev/features for replacements.';

const REFERENCING =
  'https://containers.dev/implementors/features/#referencing-a-feature';
const LEGACY = 'https://containers.dev/features';

/** The keys BR-18's observed table flags, in the order the folder lists them, with the message each earns. */
const FLAGGED: ReadonlyArray<readonly [string, string]> = [
  ['/etc/foo', S021],
  ['http://example.com/x.tgz', S121],
  ['owner/repo/bad id!', S195],
  ['a/b/c d@1', S195],
  ['localhost/owner/bad id!', S195],
  ['localhost:5000/a/b c', S195],
  ['foo:5000/owner/bad id!', S195],
  ['plain/owner/bad id!', S195],
  ['ghcr.io/owner/bad id!', S246],
  ['foo.bar/owner/bad id!', S246],
  ['ghcr.io/owner/name@sha256:abc', S246],
  ['owner/repo', S179],
  ['a/b', S179],
  ['a/b/c/d', S179],
  ['a/b/c/d e', S179],
  ['localhost:5000/a', S179],
  ['a:1/b', S179],
  ['a\\b', S179],
  ['C:\\x', S179],
  ['foo.bar\\x', S179],
  ['fish', S220],
  ['homebrew', S220],
];

/** The keys BR-18's table leaves alone. */
const CLEAN = [
  'a/b/c',
  'a/b/c@1',
  'UPPER/Case/Ok',
  'foo.bar/x',
  'ghcr.io/a',
  'ghcr.io/devcontainers/features/node:1',
  '../up',
  './ok',
  'https://example.com/x.tgz',
  '',
  'maven',
  'gradle',
  'jupyterlab',
  'myrandomfeature',
  'octocat/Hello-World/foo',
];

/** A configuration whose `features` hold `keys`, each with the value `{}` and each on a line of its own. */
function featuresText(keys: readonly string[]): string {
  return `{\n  "image": "alpine:3.22",\n  "features": {\n${keys
    .map(key => `    ${JSON.stringify(key)}: {}`)
    .join(',\n')}\n  }\n}\n`;
}

describe('the Problems panel flags malformed Feature ids (card containers-95)', function () {
  this.timeout(600_000);
  const opened: string[] = [];
  afterEach(async () => {
    for (const window of opened.splice(0)) {
      await closeWindow(window);
    }
    await setUserSetting('dev.containers.defaultFeatures', undefined);
  });

  /** Opens `folder` and returns its problems once there are `count` of them. */
  async function problemsAfterOpening(
    folder: string,
    count: number,
  ): Promise<Problem[]> {
    const window = await openFolderWindow(folder);
    opened.push(window);
    let problems: Problem[] = [];
    await waitFor(
      `${String(count)} problems in window ${window}`,
      async () => {
        problems = await problemsOf(window);
        return problems.length === count;
      },
      60_000,
    );
    return problems;
  }

  /** The folder `name` whose `.devcontainer/devcontainer.json` lists `keys`. */
  function folderOf(name: string, keys: readonly string[]): string {
    const folder = devContainerFolder(name, {});
    writeFileSync(
      path.join(folder, '.devcontainer', 'devcontainer.json'),
      featuresText(keys),
    );
    return folder;
  }

  it('F-0414 AC-9 (http-key): an http:// key is an Error with STR:S121', async () => {
    const problems = await problemsAfterOpening(
      folderOf('c95-ac9', ['http://example.com/x.tgz']),
      1,
    );
    deepStrictEqual(
      problems.map(each => [each.message, each.severity]),
      [[S121, 'error']],
    );
  });

  it('F-0414 AC-10 (table): each key of BR-18’s table earns exactly its message, and the others none', async () => {
    const problems = await problemsAfterOpening(
      folderOf('c95-ac10', [...FLAGGED.map(([key]) => key), ...CLEAN]),
      FLAGGED.length,
    );
    deepStrictEqual(
      problems.map(each => each.message),
      FLAGGED.map(([, message]) => message),
    );
  });

  it('F-0414 AC-11 (covered-files): the files in a subfolder of .devcontainer and a root .devcontainer.json are diagnosed, and the same keys in defaultFeatures are not', async () => {
    await setUserSetting('dev.containers.defaultFeatures', {
      '/etc/foo': {},
      'a/b': {},
    });
    const folder = folderOf('c95-ac11', ['plain']);
    const subfolder = path.join(folder, '.devcontainer', 'sub');
    mkdirSync(subfolder, {recursive: true});
    writeFileSync(
      path.join(subfolder, 'devcontainer.json'),
      featuresText(['/etc/foo']),
    );
    writeFileSync(
      path.join(folder, '.devcontainer.json'),
      featuresText(['a/b']),
    );
    const problems = await problemsAfterOpening(folder, 2);
    deepStrictEqual(
      problems
        .map(each => [each.file, each.message])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
      [
        ['.devcontainer.json', S179],
        ['.devcontainer/sub/devcontainer.json', S021],
      ],
    );
  });

  it('F-0414 AC-36 (legacy-words): fish and homebrew are Errors with STR:S220, the code legacy-feature and the link to the Features list, and maven, gradle, jupyterlab, myrandomfeature and "" none', async () => {
    const problems = await problemsAfterOpening(
      folderOf('c95-ac36', [
        'fish',
        'maven',
        'homebrew',
        'gradle',
        'jupyterlab',
        'myrandomfeature',
        '',
      ]),
      2,
    );
    deepStrictEqual(
      problems.map(each => [
        each.message,
        each.code,
        each.target,
        each.severity,
        each.line,
      ]),
      [
        [S220, 'legacy-feature', LEGACY, 'error', 4],
        [S220, 'legacy-feature', LEGACY, 'error', 6],
      ],
    );
  });

  it('F-0414 AC-38 (diagnostic-half): octocat/Hello-World/foo gets no diagnostic', async () => {
    const problems = await problemsAfterOpening(
      folderOf('c95-ac38', ['/etc/foo', 'octocat/Hello-World/foo']),
      1,
    );
    deepStrictEqual(
      problems.map(each => [each.message, each.code, each.target]),
      [[S021, 'referencing-a-feature', REFERENCING]],
    );
  });
});
