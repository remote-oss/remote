import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {deepStrictEqual, rejects, throws} from 'node:assert';
import {privateAssetDownload} from './acceptance.ts';
import {
  type FetchDependencies,
  cliArchivesMarked,
  fetchCliArchives,
} from './fetch-cli-archives.ts';
import {REPOSITORY_ROOT} from './repository.ts';

const BYTES = Uint8Array.of(1, 2, 3);
const DIGEST = createHash('sha256').update(BYTES).digest('hex');

/** The dependencies of a fetch into a fresh cache, with one CLI archive pinned for Alpine and the addresses asked. */
function fresh(
  answer: (address: string, token: string | undefined) => Promise<Uint8Array>,
) {
  const asked: string[] = [];
  const dependencies: FetchDependencies = {
    download: (address, token) => {
      asked.push(address);
      return answer(address, token);
    },
    writeFile: writeFileSync,
    architecture: 'x64',
    pins: {'alpine-x64': {assetId: 7, sha256: DIGEST}},
    cacheFolder: mkdtempSync(path.join(tmpdir(), 'fetch-cli-archives-')),
  };
  return {asked, dependencies};
}

describe('fetch-cli-archives', () => {
  it('fetches nothing when no chosen launch starts the CLI-source editor', async () => {
    const {asked, dependencies} = fresh(() => Promise.resolve(BYTES));
    deepStrictEqual(
      [
        await fetchCliArchives(
          REPOSITORY_ROOT,
          ['--launches', 'local'],
          'token',
          dependencies,
        ),
        asked,
      ],
      [
        [
          'no chosen launch starts the CLI-source editor, so no CLI archive is fetched',
        ],
        [],
      ],
    );
  });

  it('fetches the pinned archives of the served platforms with the token when a chosen launch starts the CLI-source editor, and keeps them on a second run', async () => {
    const tokens: Array<string | undefined> = [];
    const {asked, dependencies} = fresh((address, token) => {
      tokens.push(token);
      return Promise.resolve(BYTES);
    });
    const first = await fetchCliArchives(
      REPOSITORY_ROOT,
      ['--launches', 'cli-path'],
      'token',
      dependencies,
    );
    const second = await fetchCliArchives(
      REPOSITORY_ROOT,
      ['--launches', 'cli-path'],
      'token',
      dependencies,
    );
    deepStrictEqual(
      [
        first,
        second,
        asked,
        tokens,
        [
          ...readFileSync(
            path.join(
              String(dependencies.cacheFolder),
              'cli-alpine-x64.tar.gz',
            ),
          ),
        ],
      ],
      [
        [
          'alpine-x64: cli-alpine-x64.tar.gz matches its pin',
          'linux-x64: no CLI archive is pinned',
        ],
        [
          'alpine-x64: cli-alpine-x64.tar.gz matches its pin',
          'linux-x64: no CLI archive is pinned',
        ],
        [
          'https://api.github.com/repos/remote-oss/cli-archives/releases/assets/7',
        ],
        ['token'],
        [1, 2, 3],
      ],
    );
  });

  it('fails naming the variable when the token is missing', async () => {
    const {dependencies} = fresh((address, token) =>
      privateAssetDownload(address, token, () =>
        Promise.reject(new Error('no fetch without a token')),
      ),
    );
    await rejects(
      fetchCliArchives(
        REPOSITORY_ROOT,
        ['--launches', 'cli-path'],
        undefined,
        dependencies,
      ),
      {
        message:
          'https://api.github.com/repos/remote-oss/cli-archives/releases/assets/7: the CLI archives need REMOTE_OSS_CLI_ARCHIVES_TOKEN, a token that may read remote-oss/cli-archives',
      },
    );
  });

  it('fails when a fetched archive does not match its pin', async () => {
    const {dependencies} = fresh(() => Promise.resolve(Uint8Array.of(9)));
    await rejects(
      fetchCliArchives(
        REPOSITORY_ROOT,
        ['--launches', 'cli-path'],
        'token',
        dependencies,
      ),
      {message: 'the CLI archive download does not match its checksum'},
    );
  });

  it('fails on an entry that names nothing known', async () => {
    const {dependencies} = fresh(() => Promise.resolve(BYTES));
    await rejects(
      fetchCliArchives(
        REPOSITORY_ROOT,
        ['--launches', 'no-such-launch'],
        'token',
        dependencies,
      ),
      /no-such-launch/u,
    );
  });

  it('fails on an empty --launches with the usage', async () => {
    const {dependencies} = fresh(() => Promise.resolve(BYTES));
    await rejects(
      fetchCliArchives(
        REPOSITORY_ROOT,
        ['--launches', ''],
        'token',
        dependencies,
      ),
      {
        message:
          'usage: node tools/fetch-cli-archives.ts --launches <entries> | --mark-parts',
      },
    );
  });

  it('marks a part whose launches start the CLI-source editor, and no other, whatever the entry form', () => {
    deepStrictEqual(
      cliArchivesMarked(REPOSITORY_ROOT, [
        {name: 'cli', launches: 'cli-path', minutes: 30},
        {name: 'mixed', launches: 'local,cli-path', minutes: 30},
        {name: 'plain', launches: 'local,remote', minutes: 30},
        {
          name: 'files',
          launches: 'windows:kill.test.ts,terminal-login',
          minutes: 45,
        },
      ]).map(part => [part.name, part.cliArchives]),
      [
        ['cli', true],
        ['mixed', true],
        ['plain', false],
        ['files', false],
      ],
    );
  });

  it('marking fails on a part whose launches name nothing known', () => {
    throws(
      () =>
        cliArchivesMarked(REPOSITORY_ROOT, [
          {name: 'odd', launches: 'no-such-launch', minutes: 30},
        ]),
      /no-such-launch/u,
    );
  });
});
