/**
 * @fileoverview vsix-rules: the release's packaging rules checked against each VSIX's manifest and file list before
 * `vsce package` runs: the MIT licence, no terms or notices files, the shipped identity, the editor floor and the
 * icon.
 */

import {EDITOR_ENGINE} from './editor-floor.ts';

/** The extensions release 1 and 0.2 ship, by `${publisher}.${name}`. */
export const SHIPPED_EXTENSION_IDS: readonly string[] = [
  'remote-oss.remote-containers',
  'remote-oss.remote-ssh',
  'remote-oss.remote-ssh-edit',
  'remote-oss.remote-explorer',
  'remote-oss.vscode-remote-extensionpack',
];

/**
 * The VSIX-relative folders of the open-source dependencies we bundle, whose licence and notice files ship with
 * the bundle (their licences require the notices to accompany every redistribution, ADR-0005). A new bundle gets
 * its own entry.
 */
export const BUNDLED_DEPENDENCY_FOLDERS = ['dist/devcontainers-cli/'];

/** The manifest fields the rules read. */
export interface VsixManifest {
  name?: string;
  publisher?: string;
  license?: string;
  icon?: string;
  engines?: {vscode?: string};
}

/** The base name of a listed file. */
function baseName(file: string): string {
  return file.split(/[\\/]/).pop() ?? '';
}

/** Whether the listed path sits under one of the bundled dependency folders. */
function underBundledDependency(file: string): boolean {
  return BUNDLED_DEPENDENCY_FOLDERS.some(folder => file.startsWith(folder));
}

/** The release's packaging problems of the VSIX that `packages/<folder>` would write; an empty list packs. */
export function vsixProblems(
  folder: string,
  manifest: VsixManifest,
  files: readonly string[],
): string[] {
  const problems: string[] = [];
  if (manifest.license !== 'MIT') {
    problems.push(`packages/${folder}: the license is not MIT`);
  }
  if (
    !files.some(
      file =>
        file === 'LICENSE' || file === 'LICENSE.md' || file === 'LICENSE.txt',
    )
  ) {
    problems.push(
      `packages/${folder}: no LICENSE, LICENSE.md or LICENSE.txt at the package root`,
    );
  }
  for (const file of files) {
    if (underBundledDependency(file)) {
      continue;
    }
    const base = baseName(file);
    if (
      /^(ThirdPartyNotices|EULA|LICENSE[-_.]?(MS|Microsoft))/i.test(base) ||
      base.endsWith('.rtf')
    ) {
      problems.push(`packages/${folder}: the VSIX holds ${file}`);
    }
  }
  if (manifest.publisher !== 'remote-oss') {
    problems.push(`packages/${folder}: the publisher is not remote-oss`);
  }
  const extensionId = `${manifest.publisher ?? ''}.${manifest.name ?? ''}`;
  if (!SHIPPED_EXTENSION_IDS.includes(extensionId)) {
    problems.push(
      `packages/${folder}: ${extensionId} is not a shipped extension id`,
    );
  }
  if (manifest.engines?.vscode !== EDITOR_ENGINE) {
    problems.push(`packages/${folder}: engines.vscode is not ${EDITOR_ENGINE}`);
  }
  if (manifest.icon !== undefined) {
    if (!files.includes(manifest.icon)) {
      problems.push(
        `packages/${folder}: the icon ${manifest.icon} is not in the VSIX`,
      );
    }
    if (!manifest.icon.endsWith('.png')) {
      problems.push(
        `packages/${folder}: the icon ${manifest.icon} is not a PNG`,
      );
    }
  }
  return problems;
}
