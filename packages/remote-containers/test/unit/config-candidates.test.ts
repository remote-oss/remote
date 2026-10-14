import {deepStrictEqual} from 'node:assert';
import {configCandidates} from '../../src/open/config-candidates.ts';

/** Files that exist (absolute paths) and the subfolders of `.devcontainer`. */
function filesOf(existing: readonly string[], subfolders: readonly string[]) {
  return {
    isFile: (file: string) => Promise.resolve(existing.includes(file)),
    subfolders: () => Promise.resolve(subfolders),
  };
}

describe('the configuration lookup', () => {
  it('F-0301 5.0: a lone .devcontainer/devcontainer.json is the one candidate', async () => {
    deepStrictEqual(
      await configCandidates(
        '/w/p',
        filesOf(['/w/p/.devcontainer/devcontainer.json'], []),
      ),
      ['/w/p/.devcontainer/devcontainer.json'],
    );
  });

  it('F-0301 5.0: the dotfile, the root file and the subfolders come in that order, the subfolders sorted by name without regard to case', async () => {
    const existing = [
      '/w/p/.devcontainer.json',
      '/w/p/.devcontainer/devcontainer.json',
      '/w/p/.devcontainer/b/devcontainer.json',
      '/w/p/.devcontainer/A/devcontainer.json',
      '/w/p/.devcontainer/c/devcontainer.json',
    ];
    deepStrictEqual(
      await configCandidates('/w/p', filesOf(existing, ['b', 'A', 'c', 'd'])),
      [
        '/w/p/.devcontainer.json',
        '/w/p/.devcontainer/devcontainer.json',
        '/w/p/.devcontainer/A/devcontainer.json',
        '/w/p/.devcontainer/b/devcontainer.json',
        '/w/p/.devcontainer/c/devcontainer.json',
      ],
    );
  });

  it('F-0301 5.0: a file whose name differs in case is not a candidate', async () => {
    deepStrictEqual(
      await configCandidates(
        '/w/p',
        filesOf(['/w/p/.devcontainer/x/DevContainer.json'], ['x']),
      ),
      [],
    );
  });

  it('F-0301 5.0: a file two folders down is not a candidate', async () => {
    deepStrictEqual(
      await configCandidates(
        '/w/p',
        filesOf(['/w/p/.devcontainer/a/b/devcontainer.json'], ['a']),
      ),
      [],
    );
  });

  it('F-0301 5.0: a folder with no .devcontainer and no dotfile has none', async () => {
    deepStrictEqual(await configCandidates('/w/p', filesOf([], [])), []);
  });
});
