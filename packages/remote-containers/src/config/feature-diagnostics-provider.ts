/**
 * @fileoverview The Problems panel's view of the Feature ids: one collection of diagnostics for every dev container
 * configuration of the window's folders, read from disk with no editor open and no trust needed, and kept current by
 * the file watcher and by the changes of the open editors.
 */

import {featureProblems} from './feature-diagnostics.ts';

/** Turns an English template into the text for the display language. */
export type Translate = (template: string) => string;

/** A place in a file, zero-based. */
interface Position {
  line: number;
  character: number;
}

/** One diagnostic as the editor is given it: an Error over a range, with a code that links to a page. */
export interface FeatureDiagnostic {
  range: {start: Position; end: Position};
  message: string;
  code: {value: string; target: string};
}

/** What the end of a registration is called. */
export interface Registration {
  dispose(): void;
}

/** The parts of the editor the provider uses, over absolute paths. */
export interface DiagnosticsHost {
  /** The folders of the window. */
  folders(): readonly string[];
  onFoldersChanged(listener: () => void): Registration;
  /** The configuration files under the folder: `.devcontainer.json`, and `devcontainer.json` under `.devcontainer`. */
  findConfigurations(folder: string): Promise<readonly string[]>;
  /** The file's text from disk; none when it cannot be read or does not exist. */
  readFromDisk(file: string): Promise<string | undefined>;
  /** The text of the open document of the file; none when it is not open. */
  openText(file: string): string | undefined;
  /** Calls `listener` with a configuration file of the folder that is created, changed or deleted. */
  watch(folder: string, listener: (file: string) => void): Registration;
  /** Calls `listener` with the file of each document whose text changes. */
  onTextChanged(listener: (file: string) => void): Registration;
  setDiagnostics(file: string, diagnostics: readonly FeatureDiagnostic[]): void;
  deleteDiagnostics(file: string): void;
  dispose(): void;
}

/** The page the code of a malformed id links to, and the one of a legacy Feature. */
const TARGETS = {
  'referencing-a-feature':
    'https://containers.dev/implementors/features/#referencing-a-feature',
  'legacy-feature': 'https://containers.dev/features',
} as const;

/** The place of an offset in the text. */
function positionAt(text: string, offset: number): Position {
  const before = text.slice(0, offset);
  const line = before.split('\n').length - 1;
  return {line, character: offset - (before.lastIndexOf('\n') + 1)};
}

/** The diagnostics of the text of a configuration file. */
export function diagnosticsOf(
  text: string,
  translate: Translate,
): FeatureDiagnostic[] {
  return featureProblems(text).map(problem => ({
    range: {
      start: positionAt(text, problem.range.start),
      end: positionAt(text, problem.range.end),
    },
    message: translate(problem.message),
    code: {value: problem.code, target: TARGETS[problem.code]},
  }));
}

/** Whether the file is a configuration of the folder, by the places `findConfigurations` looks in. */
function isConfigurationOf(folder: string, file: string): boolean {
  const prefix = `${folder}/`;
  return (
    file.startsWith(prefix) &&
    /^(\.devcontainer\.json|\.devcontainer\/(.+\/)?devcontainer\.json)$/.test(
      file.slice(prefix.length),
    )
  );
}

/** Starts the diagnostics over `host`; the result ends them and clears the collection. */
export function featureDiagnosticsProviderOf(
  host: DiagnosticsHost,
  translate: Translate,
): Registration {
  const known = new Set<string>();
  const watchers: Registration[] = [];

  async function refresh(file: string): Promise<void> {
    const text = host.openText(file) ?? (await host.readFromDisk(file));
    if (text === undefined) {
      known.delete(file);
      host.deleteDiagnostics(file);
      return;
    }
    known.add(file);
    host.setDiagnostics(file, diagnosticsOf(text, translate));
  }

  async function scan(): Promise<void> {
    for (const watcher of watchers.splice(0)) {
      watcher.dispose();
    }
    const found = new Set<string>();
    for (const folder of host.folders()) {
      watchers.push(
        host.watch(folder, file => {
          void refresh(file);
        }),
      );
      for (const file of await host.findConfigurations(folder)) {
        found.add(file);
        await refresh(file);
      }
    }
    for (const file of [...known]) {
      if (!found.has(file)) {
        known.delete(file);
        host.deleteDiagnostics(file);
      }
    }
  }

  const folders = host.onFoldersChanged(() => {
    void scan();
  });
  const edits = host.onTextChanged(file => {
    if (host.folders().some(folder => isConfigurationOf(folder, file))) {
      void refresh(file);
    }
  });
  void scan();
  return {
    dispose: () => {
      folders.dispose();
      edits.dispose();
      for (const watcher of watchers.splice(0)) {
        watcher.dispose();
      }
      host.dispose();
    },
  };
}
