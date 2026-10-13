/**
 * @fileoverview Synthetic package sources for the tests of the identifier tools: an empty package that a test
 * extends with the fields its scenario needs.
 */

import type {
  DeclaredIdentifiers,
  ManifestIdentifiers,
  PackageSources,
} from './identifier-sources.ts';

/** The parts of a package's sources a test sets; everything else is empty. */
export interface SourcesOverrides {
  manifest?: Partial<ManifestIdentifiers>;
  declared?: Partial<DeclaredIdentifiers>;
}

/** The sources of `packages/remote-x` with the given fields and every other list empty. */
export function syntheticSources(
  overrides: SourcesOverrides = {},
): PackageSources {
  return {
    folder: 'remote-x',
    manifest: {
      commands: [],
      settings: [],
      views: [],
      authorities: [],
      languages: [],
      activationEvents: [],
      menuEntries: [],
      enabledApiProposals: [],
      stringReferences: [],
      ...overrides.manifest,
    },
    declared: {
      source: 'remote-oss/remote-x#1 (F-0001)',
      standsDownFor: 'ms-vscode-remote.remote-x',
      namespaces: {},
      contextKeys: [],
      infoLineCommands: [],
      internal: [],
      runtimeCommands: [],
      invented: [],
      settingPairs: [],
      ungated: [],
      ...overrides.declared,
    },
  };
}
