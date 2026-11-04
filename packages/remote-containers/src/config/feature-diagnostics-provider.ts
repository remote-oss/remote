/**
 * @fileoverview The Problems panel's view of the Feature ids: one collection of diagnostics for every dev container
 * configuration of the window, in every location form and scheme the window opens, read from the open editor first
 * and from the file system otherwise, and kept current by the file watcher, the changes of the open editors and the
 * documents the window opens.
 */

import {featureProblems} from './feature-diagnostics.ts';

/** Turns an English template into the text for the display language. */
export type Translate = (template: string) => string;

/** A place in a file, zero-based. */
interface Position {
  line: number;
  character: number;
}

/** One diagnostic as the editor is given it: a range and severity, with a code that links to a page. */
export interface FeatureDiagnostic {
  range: {start: Position; end: Position};
  severity: 'error' | 'warning';
  message: string;
  code: {value: string; target: string};
}

/** What the end of a registration is called. */
export interface Registration {
  dispose(): void;
}

/**
 * The parts of the editor the provider uses, over the string form of each file's URI: `file:///…` for a file of the
 * window's file system, and the document's own URI for a file of another scheme.
 */
export interface DiagnosticsHost {
  /** The folders of the window. */
  folders(): readonly string[];
  onFoldersChanged(listener: () => void): Registration;
  /** The configuration files under the folder: a `devcontainer.json` or `.devcontainer.json` in any of its folders. */
  findConfigurations(folder: string): Promise<readonly string[]>;
  /** The file's text from its file system; none when it cannot be read or does not exist. */
  readFromDisk(file: string): Promise<string | undefined>;
  /** The text of the open document of the file; none when it is not open. */
  openText(file: string): string | undefined;
  /** The URIs of the window's open documents. */
  openDocuments(): readonly string[];
  /** Calls `listener` with the file that is created, changed or deleted under the folder. */
  watch(folder: string, listener: (file: string) => void): Registration;
  /** Calls `listener` with the URI of each document that opens. */
  onDidOpenTextDocument(listener: (file: string) => void): Registration;
  /** Calls `listener` with the URI of each document whose text changes. */
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

/** The names a dev container configuration file may wear. */
const CONFIGURATION_NAMES = new Set([
  'devcontainer.json',
  '.devcontainer.json',
]);

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
    severity: problem.severity,
    message: translate(problem.message),
    code: {value: problem.code, target: TARGETS[problem.code]},
  }));
}

/** The name of the file at the end of the path of a document's URI. */
function nameOf(uri: string): string {
  const path = uri.replace(/[#?].*$/, '');
  const tail = path.includes('://')
    ? path.slice(path.indexOf('://') + 3)
    : path.slice(path.indexOf(':') + 1);
  const slash = tail.lastIndexOf('/');
  return slash < 0 ? tail : tail.slice(slash + 1);
}

/** Whether the file is a configuration, by its name alone: any place in any scheme is a location form. */
function isConfigurationFile(file: string): boolean {
  return CONFIGURATION_NAMES.has(nameOf(file));
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
    for (const file of host.openDocuments()) {
      if (!isConfigurationFile(file)) {
        continue;
      }
      found.add(file);
      void refresh(file);
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
  const opens = host.onDidOpenTextDocument(file => {
    if (isConfigurationFile(file)) {
      void refresh(file);
    }
  });
  const edits = host.onTextChanged(file => {
    if (isConfigurationFile(file)) {
      void refresh(file);
    }
  });
  void scan();
  return {
    dispose: () => {
      folders.dispose();
      opens.dispose();
      edits.dispose();
      for (const watcher of watchers.splice(0)) {
        watcher.dispose();
      }
      host.dispose();
    },
  };
}
