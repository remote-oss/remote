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
  openListeners: Array<(file: string) => void> = [];
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
      [...this.disk.keys()].filter(
        file =>
          file.startsWith(`${folder}/`) && file.endsWith('devcontainer.json'),
      ),
    );
  }
  readFromDisk(file: string): Promise<string | undefined> {
    return Promise.resolve(this.disk.get(file));
  }
  openText(file: string): string | undefined {
    return this.open.get(file);
  }
  openDocuments(): readonly string[] {
    return [...this.open.keys()];
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
  onDidOpenTextDocument(listener: (file: string) => void) {
    this.openListeners.push(listener);
    return {dispose: () => undefined};
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

  it('F-0414 3.3: a diagnostic holds the key’s range, the error severity, the message and the code with the page it links to', () => {
    deepStrictEqual(
      diagnosticsOf(BAD_TEXT, template => template),
      [
        {
          range: {
            start: {line: 2, character: 4},
            end: {line: 2, character: 18},
          },
          severity: 'error',
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

  describe('the reach over every location form and scheme (F-0810 AC-25, AC-42)', () => {
    /** The open documents of every form and scheme, and what each URI earns. */
    const OPENS: ReadonlyArray<readonly [string, string?]> = [
      ['file:///w/devcontainer.json', BAD_TEXT],
      ['file:///w/.devcontainer/devcontainer.json', BAD_TEXT],
      ['file:///w/.devcontainer.json', BAD_TEXT],
      ['ssh-remote+host:/home/user/project/devcontainer.json', BAD_TEXT],
      ['dev-container+abc123:/workspaces/p/.devcontainer.json', BAD_TEXT],
      ['memfs:/devcontainer.json', BAD_TEXT],
      ['memfs:devcontainer.json', BAD_TEXT],
      ['file:///w/devcontainer.json?probe=1#anchor', BAD_TEXT],
      ['/w/.devcontainer.json', BAD_TEXT],
      ['memfs:/notes.json', BAD_TEXT],
      ['untitled:Untitled-1', BAD_TEXT],
      ['memfs:/work/devcontainer.json.bak', BAD_TEXT],
    ];

    it('F-0810 AC-25, AC-42 (c208-provider-schemes): an opened configuration is diagnosed in every location form and scheme, and the documents that are not configurations are left alone', async () => {
      const host = new FakeHost();
      for (const [file, text] of OPENS) {
        if (text !== undefined) {
          host.open.set(file, text);
        }
      }
      featureDiagnosticsProviderOf(host, template => template);
      await settled();
      for (const listener of host.openListeners) {
        for (const [file, text] of OPENS) {
          if (text !== undefined) {
            listener(file);
          }
        }
      }
      await settled();
      const expected: Array<[string, number]> = [
        ['/w/.devcontainer.json', 1],
        ['dev-container+abc123:/workspaces/p/.devcontainer.json', 1],
        ['file:///w/.devcontainer/devcontainer.json', 1],
        ['file:///w/.devcontainer.json', 1],
        ['file:///w/devcontainer.json', 1],
        ['file:///w/devcontainer.json?probe=1#anchor', 1],
        ['memfs:/devcontainer.json', 1],
        ['memfs:devcontainer.json', 1],
        ['ssh-remote+host:/home/user/project/devcontainer.json', 1],
      ];
      deepStrictEqual(
        messages(host)
          .map(([file, held]) => [file, held.length])
          .sort((left, right) =>
            String(left[0]).localeCompare(String(right[0])),
          ),
        [...expected].sort((left, right) => left[0].localeCompare(right[0])),
      );
    });

    it('F-0810 AC-25, AC-42 (c208-provider-open-scan): the open documents of the start are found by the scan, and a rescan does not drop them', async () => {
      const host = new FakeHost();
      host.open.set('memfs:/devcontainer.json', BAD_TEXT);
      featureDiagnosticsProviderOf(host, template => template);
      await settled();
      host.folderList = ['/w'];
      for (const listener of host.folderListeners) {
        listener();
      }
      await settled();
      deepStrictEqual(
        messages(host).map(([file, held]) => [file, held.length]),
        [['memfs:/devcontainer.json', 1]],
      );
    });

    it('F-0810 AC-43 (c208-provider-edit): a change of the text of an open configuration refreshes it from its buffer, whatever its scheme', async () => {
      const host = new FakeHost();
      host.open.set('memfs:/devcontainer.json', GOOD_TEXT);
      featureDiagnosticsProviderOf(host, template => template);
      await settled();
      host.open.set('memfs:/devcontainer.json', BAD_TEXT);
      for (const listener of host.textListeners) {
        listener('memfs:/devcontainer.json');
      }
      await settled();
      deepStrictEqual(
        messages(host).map(([file, held]) => [file, held.length]),
        [['memfs:/devcontainer.json', 1]],
      );
    });
  });
});
