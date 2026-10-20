import {deepStrictEqual} from 'node:assert';
import {
  type DiagnosticsHost,
  type FeatureDiagnostic,
  diagnosticsOf,
  featureDiagnosticsProviderOf,
} from '../../src/config/feature-diagnostics-provider.ts';

const BAD_TEXT = '{\n  "features": {\n    "/etc/foo": {}\n  }\n}';
const GOOD_TEXT = '{"features": {"ghcr.io/a/b/c": {}}}';

/** A host whose files, open documents and events the test drives, and which records what the collection holds. */
class FakeHost implements DiagnosticsHost {
  folderList: string[] = ['/w'];
  disk = new Map<string, string>();
  open = new Map<string, string>();
  collection = new Map<string, readonly FeatureDiagnostic[]>();
  watching: string[] = [];
  watchers = new Map<string, Array<(file: string) => void>>();
  textListeners: Array<(file: string) => void> = [];
  folderListeners: Array<() => void> = [];
  disposed = 0;
  stopped = 0;

  folders(): readonly string[] {
    return this.folderList;
  }
  onFoldersChanged(listener: () => void) {
    this.folderListeners.push(listener);
    return {dispose: () => undefined};
  }
  findConfigurations(folder: string): Promise<readonly string[]> {
    return Promise.resolve(
      [...this.disk.keys()].filter(file => file.startsWith(`${folder}/`)),
    );
  }
  readFromDisk(file: string): Promise<string | undefined> {
    return Promise.resolve(this.disk.get(file));
  }
  openText(file: string): string | undefined {
    return this.open.get(file);
  }
  watch(folder: string, listener: (file: string) => void) {
    this.watching.push(folder);
    this.watchers.set(folder, [...(this.watchers.get(folder) ?? []), listener]);
    return {
      dispose: () => {
        this.stopped += 1;
      },
    };
  }
  onTextChanged(listener: (file: string) => void) {
    this.textListeners.push(listener);
    return {dispose: () => undefined};
  }
  setDiagnostics(
    file: string,
    diagnostics: readonly FeatureDiagnostic[],
  ): void {
    this.collection.set(file, diagnostics);
  }
  deleteDiagnostics(file: string): void {
    this.collection.delete(file);
  }
  dispose(): void {
    this.disposed += 1;
  }
}

/** Lets the provider's pending reads end. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    await Promise.resolve();
  }
}

/** The messages the collection holds, by file. */
function messages(host: FakeHost): Array<[string, string[]]> {
  return [...host.collection.entries()]
    .map(([file, held]): [string, string[]] => [
      file,
      held.map(each => each.message),
    ])
    .sort();
}

describe('the Problems panel’s Feature ids (card containers-95)', () => {
  it('F-0414 AC-8: a file is read from disk when the provider starts, with no editor open', async () => {
    const host = new FakeHost();
    host.disk.set('/w/.devcontainer/devcontainer.json', BAD_TEXT);
    host.disk.set('/w/.devcontainer.json', GOOD_TEXT);
    featureDiagnosticsProviderOf(host, template => template);
    await settled();
    deepStrictEqual(messages(host), [
      ['/w/.devcontainer.json', []],
      [
        '/w/.devcontainer/devcontainer.json',
        [
          'Absolute file paths are not allowed. Local file path must be indicated relative to the devcontainer.json.',
        ],
      ],
    ]);
  });

  it('F-0414 3.3: a diagnostic holds the key’s range, the message and the code with the page it links to', () => {
    deepStrictEqual(
      diagnosticsOf(BAD_TEXT, template => template),
      [
        {
          range: {
            start: {line: 2, character: 4},
            end: {line: 2, character: 18},
          },
          message:
            'Absolute file paths are not allowed. Local file path must be indicated relative to the devcontainer.json.',
          code: {
            value: 'referencing-a-feature',
            target:
              'https://containers.dev/implementors/features/#referencing-a-feature',
          },
        },
      ],
    );
  });

  it('F-0414 3.3: the message is the template in the display language', () => {
    deepStrictEqual(
      diagnosticsOf(
        '{"features": {"fish": {}}}',
        template => `<${template}>`,
      ).map(each => each.message),
      [
        '<Legacy feature not supported. Please check https://containers.dev/features for replacements.>',
      ],
    );
  });

  it('F-0414 AC-36: the code of a legacy Feature links to the page of the Features', () => {
    deepStrictEqual(
      diagnosticsOf('{"features": {"fish": {}}}', template => template).map(
        each => each.code,
      ),
      [{value: 'legacy-feature', target: 'https://containers.dev/features'}],
    );
  });

  it('F-0414 3.3: a change of the file on disk updates the collection, and a deletion empties it', async () => {
    const host = new FakeHost();
    host.disk.set('/w/.devcontainer.json', GOOD_TEXT);
    featureDiagnosticsProviderOf(host, template => template);
    await settled();
    host.disk.set('/w/.devcontainer.json', BAD_TEXT);
    host.watchers.get('/w')?.[0]?.('/w/.devcontainer.json');
    await settled();
    const changed = messages(host).length;
    host.disk.delete('/w/.devcontainer.json');
    host.watchers.get('/w')?.[0]?.('/w/.devcontainer.json');
    await settled();
    deepStrictEqual([changed, messages(host)], [1, []]);
  });

  it('F-0414 3.3: a change of an open editor updates the collection from its text, and a file that is no configuration is left alone', async () => {
    const host = new FakeHost();
    host.disk.set('/w/.devcontainer/a/devcontainer.json', GOOD_TEXT);
    featureDiagnosticsProviderOf(host, template => template);
    await settled();
    host.open.set('/w/.devcontainer/a/devcontainer.json', BAD_TEXT);
    host.open.set('/w/other.json', BAD_TEXT);
    for (const listener of host.textListeners) {
      listener('/w/.devcontainer/a/devcontainer.json');
      listener('/w/other.json');
      listener('/v/.devcontainer.json');
      listener('/w/.devcontainer/notes.json');
    }
    await settled();
    deepStrictEqual(
      messages(host).map(([file, held]) => [file, held.length]),
      [['/w/.devcontainer/a/devcontainer.json', 1]],
    );
  });

  it('F-0414 3.3: the folders of the window are watched, and a change of the folders scans again and drops what is gone', async () => {
    const host = new FakeHost();
    host.folderList = ['/w', '/x'];
    host.disk.set('/w/.devcontainer.json', BAD_TEXT);
    host.disk.set('/x/.devcontainer.json', BAD_TEXT);
    featureDiagnosticsProviderOf(host, template => template);
    await settled();
    host.folderList = ['/w'];
    for (const listener of host.folderListeners) {
      listener();
    }
    await settled();
    deepStrictEqual(
      [host.watching, host.stopped, messages(host).map(([file]) => file)],
      [['/w', '/x', '/w'], 2, ['/w/.devcontainer.json']],
    );
  });

  it('F-0414 3.3: ending the provider ends its watchers and clears the collection', async () => {
    const host = new FakeHost();
    host.disk.set('/w/.devcontainer.json', BAD_TEXT);
    const provider = featureDiagnosticsProviderOf(host, template => template);
    await settled();
    provider.dispose();
    deepStrictEqual([host.stopped, host.disposed], [1, 1]);
  });
});
