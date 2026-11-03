import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  mirroredCandidatesOf,
  type MirroredLookupPorts,
} from '../../src/config/mirrored-lookup.ts';

/** A file system of folders by absolute path, each with the names it holds; a name ending in / is a folder. */
function listOf(
  files: Readonly<Record<string, readonly string[]>>,
): MirroredLookupPorts['list'] {
  return folder =>
    Promise.resolve(
      (files[folder] ?? []).map(name =>
        name.endsWith('/')
          ? {name: name.slice(0, -1), kind: 'folder' as const}
          : {name, kind: 'file' as const},
      ),
    );
}

interface Scene {
  ports: MirroredLookupPorts;
  asked: string[];
  sink: MemorySink;
}

/** The lookup over a file system, with the remotes `printed`, the roots, and a folder that is trusted or not. */
function sceneOf(
  options: {
    printed?: string;
    roots?: readonly string[];
    trusted?: boolean;
    files?: Readonly<Record<string, readonly string[]>>;
  } = {},
): Scene {
  const asked: string[] = [];
  const sink = new MemorySink();
  return {
    asked,
    sink,
    ports: {
      trusted: () => options.trusted ?? true,
      roots: () => options.roots ?? [],
      remotes: folder => {
        asked.push(folder);
        return Promise.resolve(options.printed);
      },
      list: listOf(options.files ?? {}),
      compare: (left, right) => left.localeCompare(right),
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
    },
  };
}

const ROOT = path.resolve('/roots/one');
const MIRRORED = path.join(ROOT, 'github.com', 'o', 'n');

describe('the lookup of a repository’s configuration (card containers-161, F-0302)', () => {
  it('F-0302 AC-1: a remote’s mirrored folder with a configuration gives it', async () => {
    const scene = sceneOf({
      printed: 'remote.origin.url https://github.com/o/n.git\n',
      roots: [ROOT],
      files: {
        [MIRRORED]: ['.devcontainer/'],
        [path.join(MIRRORED, '.devcontainer')]: ['devcontainer.json'],
      },
    });
    deepStrictEqual(
      (await mirroredCandidatesOf(scene.ports, '/w/p')).map(each => each.file),
      [`${MIRRORED}/.devcontainer/devcontainer.json`],
    );
  });

  it('F-0302 BR-6: an untrusted folder looks nothing up and runs no git', async () => {
    const scene = sceneOf({
      printed: 'remote.origin.url https://github.com/o/n.git\n',
      roots: [ROOT],
      trusted: false,
      files: {[MIRRORED]: ['.devcontainer.json']},
    });
    deepStrictEqual(
      [await mirroredCandidatesOf(scene.ports, '/w/p'), scene.asked],
      [[], []],
    );
  });

  it('F-0302 BR-7: with no root git is not run either', async () => {
    const scene = sceneOf({
      printed: 'remote.origin.url https://github.com/o/n.git\n',
    });
    deepStrictEqual(
      [await mirroredCandidatesOf(scene.ports, '/w/p'), scene.asked],
      [[], []],
    );
  });

  it('F-0302 7.E1, AC-18: a root that does not exist, and a root with no folder for the remote, give nothing', async () => {
    const scene = sceneOf({
      printed: 'remote.origin.url https://github.com/o/n.git\n',
      roots: [path.resolve('/missing'), ROOT],
    });
    deepStrictEqual(await mirroredCandidatesOf(scene.ports, '/w/p'), []);
  });

  it('F-0302 AC-31: two remotes with different URLs give both files, and one URL twice gives one', async () => {
    const other = path.join(ROOT, 'github.com', 'u', 'n');
    const scene = sceneOf({
      printed: [
        'remote.origin.url https://github.com/o/n.git',
        'remote.upstream.url git@github.com:u/n.git',
        'remote.copy.url https://github.com/o/n.git',
      ].join('\n'),
      roots: [ROOT],
      files: {
        [MIRRORED]: ['.devcontainer.json'],
        [other]: ['.devcontainer.json'],
      },
    });
    deepStrictEqual(
      (await mirroredCandidatesOf(scene.ports, '/w/p')).map(each => each.file),
      [`${MIRRORED}/.devcontainer.json`, `${other}/.devcontainer.json`],
    );
  });

  it('F-0302 AC-12: two roots with a file each give both, the roots in the order of the setting', async () => {
    const second = path.resolve('/roots/two');
    const scene = sceneOf({
      printed: 'remote.origin.url https://github.com/o/n.git\n',
      roots: [second, ROOT],
      files: {
        [path.join(second, 'github.com', 'o', 'n')]: ['.devcontainer.json'],
        [MIRRORED]: ['.devcontainer.json'],
      },
    });
    deepStrictEqual(
      (await mirroredCandidatesOf(scene.ports, '/w/p')).map(each => each.file),
      [
        `${path.join(second, 'github.com', 'o', 'n')}/.devcontainer.json`,
        `${MIRRORED}/.devcontainer.json`,
      ],
    );
  });

  it('F-0302 BR-1: a remote that names nothing, and no remote at all, give nothing', async () => {
    const unusual = sceneOf({
      printed: 'remote.a.url https://host/../../etc\nremote.b.url /srv/o/n\n',
      roots: [ROOT],
    });
    const none = sceneOf({roots: [ROOT]});
    deepStrictEqual(
      [
        await mirroredCandidatesOf(unusual.ports, '/w/p'),
        await mirroredCandidatesOf(none.ports, '/w/p'),
      ],
      [[], []],
    );
  });

  it('F-0302 BR-1: the remotes are read in the opened folder', async () => {
    const scene = sceneOf({roots: [ROOT], printed: ''});
    await mirroredCandidatesOf(scene.ports, '/w/p/sub');
    deepStrictEqual(scene.asked, ['/w/p/sub']);
  });

  it('F-0302 BR-1: a derived path that resolves outside its root is skipped and logged, whatever derived it', async () => {
    const scene = sceneOf({
      printed: 'remote.origin.url https://github.com/o/n.git\n',
      roots: [ROOT],
      files: {[path.resolve('/roots/x')]: ['.devcontainer.json']},
    });
    deepStrictEqual(
      await mirroredCandidatesOf(scene.ports, '/w/p', () => ['../x']),
      [],
    );
  });

  it('R-26: no log line holds the credential of a remote’s authority, whether it maps to a folder, escapes its root or names nothing', async () => {
    const scene = sceneOf({
      printed: [
        'remote.a.url https://oauth2:s3cr3t-token@gitlab.com/o/n.git',
        'remote.b.url https://s3cr3t-token@github.com/o/n',
        'remote.c.url https://user:s3cr3t-token@host/../../etc',
      ].join('\n'),
      roots: [ROOT],
    });
    await mirroredCandidatesOf(scene.ports, '/w/p');
    await mirroredCandidatesOf(scene.ports, '/w/p', () => [
      't:s3cr3t-token@h/../x',
    ]);
    const logged = JSON.stringify(scene.sink.lines);
    deepStrictEqual(
      [
        logged.includes('s3cr3t-token'),
        logged.includes(path.join(ROOT, 'gitlab.com', 'o', 'n')),
        logged.includes(path.join(ROOT, 'github.com', 'o', 'n')),
        logged.includes('https://host/../../etc'),
      ],
      [false, true, true, true],
    );
  });
});
