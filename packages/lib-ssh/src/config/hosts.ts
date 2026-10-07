/**
 * @fileoverview The host list: every concrete name of a `Host` line or a `Match host` value, file tree by file
 * tree, with included files after the including file and level by level. Nothing is cached; every call reads the
 * files again through the port.
 */

import type {PlatformPath} from 'node:path';
import type {ClientLocations, ConfigFileReader, FileInEffect} from './files.ts';
import {filesInEffect, pathsFor} from './files.ts';
import type {Directive} from './lexer.ts';
import {lexConfiguration} from './lexer.ts';

/** One entry of the host list and the file that defines it. */
export interface HostEntry {
  name: string;
  file: string;
}

/** The host list, or the file in effect that could not be parsed. */
export type HostListResult =
  {hosts: HostEntry[]} | {parseError: {file: string; reason: string}};

/** `Match` criteria that take no argument. */
const BARE_CRITERIA = new Set(['all', 'canonical', 'final']);

/** Characters that make a name a pattern rather than a host. */
const PATTERN_CHARACTERS = /[*?]/;

/** Characters that make an `Include` path a glob. */
const GLOB_CHARACTERS = /[*?[]/;

/** Forms of an `Include` path the reader does not expand. */
const UNEXPANDED_FORMS = /\$\{|%/;

/**
 * The host list for the files in effect: each tree's entries without repeats, the trees one after another with
 * repeats between them kept.
 */
export function listHosts(
  configFile: string,
  locations: ClientLocations,
  reader: ConfigFileReader,
): HostListResult {
  const hosts: HostEntry[] = [];
  for (const root of filesInEffect(configFile, locations, reader)) {
    const tree = readTree(root, locations, reader);
    if ('parseError' in tree) {
      return tree;
    }
    hosts.push(...tree.hosts);
  }
  return {hosts};
}

/** The entries of one file and everything it includes, breadth first, each name once. */
function readTree(
  root: FileInEffect,
  locations: ClientLocations,
  reader: ConfigFileReader,
): HostListResult {
  const paths = pathsFor(locations.platform);
  if (!paths.isAbsolute(root.file)) {
    return {hosts: []};
  }
  const rootText = reader.readText(root.file);
  if (rootText === undefined) {
    return {hosts: []};
  }
  const rootLexed = lexConfiguration(rootText);
  if ('parseError' in rootLexed) {
    return {parseError: {file: root.file, reason: rootLexed.parseError}};
  }
  const seenNames = new Set<string>();
  const seenFiles = new Set([root.file]);
  const hosts: HostEntry[] = [];
  let level = [{file: root.file, directives: rootLexed.directives}];
  while (level.length > 0) {
    const nextFiles: string[] = [];
    for (const current of level) {
      const reading = readDirectives(current.directives);
      for (const name of reading.names) {
        if (!seenNames.has(name)) {
          seenNames.add(name);
          hosts.push({name, file: current.file});
        }
      }
      for (const include of reading.includes) {
        nextFiles.push(
          ...includedFiles(include, root.includeBase, locations, reader),
        );
      }
    }
    level = [];
    for (const file of nextFiles) {
      if (seenFiles.has(file)) {
        continue;
      }
      seenFiles.add(file);
      const text = reader.readText(file);
      const lexed = text === undefined ? undefined : lexConfiguration(text);
      if (lexed !== undefined && 'directives' in lexed) {
        level.push({file, directives: lexed.directives});
      }
    }
  }
  return {hosts};
}

/** A file's host names in line order and the `Include` paths it follows. */
function readDirectives(directives: Directive[]): {
  names: string[];
  includes: string[];
} {
  const names: string[] = [];
  const includes: string[] = [];
  let followsIncludes = true;
  for (const directive of directives) {
    const keyword = directive.keyword.toLowerCase();
    if (keyword === 'host') {
      names.push(...directive.words.filter(isHostName));
      followsIncludes = directive.words.includes('*');
    } else if (keyword === 'match') {
      const value = matchHostValue(directive.words);
      if (value !== undefined && isHostName(value)) {
        names.push(value);
      }
      followsIncludes = false;
    } else if (
      keyword === 'include' &&
      followsIncludes &&
      directive.words.length === 1
    ) {
      includes.push(...directive.words);
    }
  }
  return {names, includes};
}

/** Whether a pattern names a concrete host: no wildcard anywhere and no leading negation. */
function isHostName(pattern: string): boolean {
  return !PATTERN_CHARACTERS.test(pattern) && !pattern.startsWith('!');
}

/** The value of the last `host` criterion of a `Match` line, if it has one. */
function matchHostValue(words: string[]): string | undefined {
  let value: string | undefined;
  for (let index = 0; index < words.length; index++) {
    const word = words[index] ?? '';
    const equals = word.indexOf('=');
    const criterion = (equals < 0 ? word : word.slice(0, equals)).toLowerCase();
    if (BARE_CRITERIA.has(criterion)) {
      continue;
    }
    const argument = equals < 0 ? words[++index] : word.slice(equals + 1);
    if (criterion === 'host' && argument !== undefined) {
      value = argument;
    }
  }
  return value;
}

/** The existing files an `Include` path names, glob matches in reverse code-point order. */
function includedFiles(
  include: string,
  includeBase: string,
  locations: ClientLocations,
  reader: ConfigFileReader,
): string[] {
  if (UNEXPANDED_FORMS.test(include)) {
    return [];
  }
  const paths = pathsFor(locations.platform);
  const expanded = include.startsWith('~/')
    ? paths.join(locations.homeFolder, include.slice(2))
    : include;
  const absolute = paths.isAbsolute(expanded)
    ? paths.normalize(expanded)
    : paths.join(includeBase, expanded);
  if (!GLOB_CHARACTERS.test(absolute)) {
    return [absolute];
  }
  return expandGlob(absolute, paths, reader);
}

/** The paths that match a glob, segment by segment; hidden names match only a pattern that starts with a dot. */
function expandGlob(
  pattern: string,
  paths: PlatformPath,
  reader: ConfigFileReader,
): string[] {
  const root = paths.parse(pattern).root;
  const segments = pattern.slice(root.length).split(paths.sep);
  let candidates = [root];
  for (const segment of segments) {
    if (!GLOB_CHARACTERS.test(segment)) {
      candidates = candidates.map(folder => paths.join(folder, segment));
      continue;
    }
    const matcher = globMatcher(segment);
    candidates = candidates.flatMap(folder =>
      (reader.listFolder(folder) ?? [])
        .filter(name => matcher(name))
        .sort(compareReverseCodePoints)
        .map(name => paths.join(folder, name)),
    );
  }
  return candidates;
}

/** Orders names from the highest code point sequence to the lowest. */
function compareReverseCodePoints(first: string, second: string): number {
  if (first === second) {
    return 0;
  }
  return first < second ? 1 : -1;
}

/** A test for one path segment of a glob: `*`, `?` and bracket classes, a leading dot matched only literally. */
function globMatcher(segment: string): (name: string) => boolean {
  let source = '';
  for (let index = 0; index < segment.length; index++) {
    const character = segment.charAt(index);
    const closing = character === '[' ? segment.indexOf(']', index + 2) : -1;
    if (character === '*') {
      source += '.*';
    } else if (character === '?') {
      source += '.';
    } else if (closing > 0) {
      const members = segment.slice(index + 1, closing);
      source += `[${members.startsWith('!') ? `^${members.slice(1)}` : members}]`;
      index = closing;
    } else {
      source += character.replace(/[\\^$.|+(){}[\]]/g, '\\$&');
    }
  }
  const expression = new RegExp(`^${source}$`, 'u');
  const allowsHidden = segment.startsWith('.');
  return name =>
    (allowsHidden || !name.startsWith('.')) && expression.test(name);
}
