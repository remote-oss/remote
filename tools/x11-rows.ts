/**
 * @fileoverview The X11 rows: the acceptance rows that drive the host's display with an X11 tool (xdotool, xprop or
 * xwininfo). They run only on a Linux launch, so each is wrapped in linuxOnly, and this file pins the list of them —
 * x11Problems names a tool in an unpinned file, a row that drives the display without the wrap, a wrap that is not
 * listed, and a pinned row that is gone.
 */

import {NAME_PATTERN} from './check-coverage.ts';

/** What the check reads of a source file: its path, relative to the repository root, and its text. */
export interface X11Source {
  path: string;
  text: string;
}

/** A pinned X11 row: the row's criterion and case label, and the file it is in. */
export interface PinnedX11Row {
  file: string;
  label: string;
}

/** The X11 tools whose names mark a file that drives the display. */
const X11_TOOLS = ['xdotool', 'xprop', 'xwininfo'] as const;

/** The pinned X11 modules: the files that name an X11 tool. */
export const PINNED_X11_MODULES: readonly string[] = [
  'tests/acceptance/containers-trust/native-folder-dialog.ts',
];

/** The pinned X11 rows: the rows that drive the display, each wrapped in linuxOnly. */
export const PINNED_X11_ROWS: readonly PinnedX11Row[] = [
  {
    file: 'tests/acceptance/containers-trust/gate.test.ts',
    label: 'F-0106 AC-50 (c123-native-dialog)',
  },
];

/** The wrap that keeps an X11 row off the displays it cannot drive. */
const LINUX_ONLY_WRAP = 'linuxOnly';

/** The functions a X11 module exports: the drivers its rows call. */
function driversOf(moduleText: string): string[] {
  return [...moduleText.matchAll(/^export (?:async )?function (\w+)/gm)].map(
    match => match[1] ?? '',
  );
}

/** The rows of a file: each name and where its `it(` begins, so the text between two rows is one row's. */
function rowsOf(text: string): Array<{name: string; start: number}> {
  return [...text.matchAll(NAME_PATTERN)].map(match => ({
    name: (match[2] ?? match[3] ?? '') + (match[4] ?? ''),
    start: match.index,
  }));
}

/** The criterion and case label of a row name: its text up to the colon that introduces the rest. */
function rowLabel(name: string): string {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(0, colon);
}

/** The tools `text` names. */
function toolsIn(text: string): string[] {
  return X11_TOOLS.filter(tool => text.includes(tool));
}

/** Whether the import specifiers of `text` reach the module at `modulePath`. */
function imports(text: string, modulePath: string): boolean {
  const base = modulePath.slice(modulePath.lastIndexOf('/') + 1);
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`from\\s+['"][^'"]*${escaped}['"]`).test(text);
}

/**
 * What is wrong with `sources` against the pins: an X11 tool in an unpinned file, a pinned module that is gone or
 * no longer drives the display, a row file that imports a pinned module without being pinned, a row that drives
 * the display without the wrap or without being listed, a wrap that is not listed, and a pinned row that is gone.
 */
export function x11Problems(sources: readonly X11Source[]): string[] {
  const problems: string[] = [];
  const byPath = new Map(sources.map(source => [source.path, source]));
  const toolPaths = new Set(
    sources
      .filter(source => toolsIn(source.text).length > 0)
      .map(source => source.path),
  );

  for (const source of sources) {
    const tools = toolsIn(source.text);
    if (tools.length > 0 && !PINNED_X11_MODULES.includes(source.path)) {
      problems.push(
        `${source.path} names ${tools.join(' and ')} but is not a pinned X11 module`,
      );
    }
  }
  for (const modulePath of PINNED_X11_MODULES) {
    const source = byPath.get(modulePath);
    if (source === undefined) {
      problems.push(`the pinned X11 module ${modulePath} is gone`);
    } else if (!toolPaths.has(modulePath)) {
      problems.push(
        `the pinned X11 module ${modulePath} no longer drives the display`,
      );
    }
  }

  const drivers = PINNED_X11_MODULES.flatMap(modulePath => {
    const source = byPath.get(modulePath);
    return source === undefined ? [] : driversOf(source.text);
  });
  const pinnedByFile = new Map<string, string[]>();
  for (const entry of PINNED_X11_ROWS) {
    const labels = pinnedByFile.get(entry.file) ?? [];
    labels.push(entry.label);
    pinnedByFile.set(entry.file, labels);
  }
  for (const source of sources) {
    if (
      source.path.endsWith('.test.ts') &&
      !pinnedByFile.has(source.path) &&
      PINNED_X11_MODULES.some(modulePath => imports(source.text, modulePath))
    ) {
      problems.push(
        `${source.path} imports a pinned X11 module but is not a pinned X11 row file`,
      );
    }
  }

  for (const [filePath, pinnedLabels] of [...pinnedByFile].sort(
    (left, right) => (left[0] < right[0] ? -1 : 1),
  )) {
    const source = byPath.get(filePath);
    if (source === undefined) {
      for (const label of pinnedLabels) {
        problems.push(
          `the pinned X11 row ${label} is gone: ${filePath} is not in the tree`,
        );
      }
      continue;
    }
    const rows = rowsOf(source.text);
    const seenLabels = new Set(rows.map(each => rowLabel(each.name)));
    for (let place = 0; place < rows.length; place += 1) {
      const thisRow = rows[place];
      if (thisRow === undefined) {
        continue;
      }
      const regionEnd = rows[place + 1]?.start ?? source.text.length;
      const region = source.text.slice(thisRow.start, regionEnd);
      const drives = drivers.some(driver => region.includes(driver));
      const wrapped = region.includes(LINUX_ONLY_WRAP);
      const listed = pinnedLabels.includes(rowLabel(thisRow.name));
      if (drives && !wrapped) {
        problems.push(
          `the row ${thisRow.name} in ${filePath} drives the display but is not wrapped in ${LINUX_ONLY_WRAP}`,
        );
      }
      if (wrapped && !listed) {
        problems.push(
          `the row ${thisRow.name} in ${filePath} is wrapped in ${LINUX_ONLY_WRAP} but is not in the pinned X11 rows`,
        );
      }
    }
    for (const label of pinnedLabels) {
      if (!seenLabels.has(label)) {
        problems.push(
          `the pinned X11 row ${label} is no longer in ${filePath}`,
        );
      }
    }
  }
  return problems;
}
