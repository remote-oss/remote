import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {REPOSITORY_ROOT, sortedEntries} from './repository.ts';
import {
  PINNED_X11_MODULES,
  PINNED_X11_ROWS,
  type X11Source,
  x11Problems,
} from './x11-rows.ts';

/** Every .ts source under `folder`, as the check reads them. */
function sourcesUnder(folder: string): X11Source[] {
  const pending: string[] = [folder];
  const sources: X11Source[] = [];
  while (pending.length > 0) {
    const next = pending.pop() ?? '';
    for (const entry of sortedEntries(next)) {
      const full = path.join(next, entry.name);
      if (entry.isDirectory()) {
        const skipped = ['.tsc', 'node_modules', 'dist'].some(name =>
          entry.name.startsWith(name),
        );
        if (!skipped) {
          pending.push(full);
        }
      } else if (entry.name.endsWith('.ts')) {
        sources.push({
          path: path.relative(REPOSITORY_ROOT, full),
          text: readFileSync(full, 'utf8'),
        });
      }
    }
  }
  return sources;
}

const MODULE_PATH = PINNED_X11_MODULES[0] ?? '';
const ROW_PATH = PINNED_X11_ROWS[0]?.file ?? '';
const MODULE_TEXT = [
  'export async function answerNativeFolderDialog(folder: string): Promise<void> {',
  "  await drive('xdotool', folder);",
  '}',
].join('\n');
const ROW_TEXT_WRAPPED = [
  "import {answerNativeFolderDialog} from './native-folder-dialog.ts';",
  "it('F-0106 AC-50 (c123-native-dialog): the row', linuxOnly(async () => {",
  "  await answerNativeFolderDialog('/f');",
  '}));',
].join('\n');
const ROW_TEXT_UNWRAPPED = [
  "import {answerNativeFolderDialog} from './native-folder-dialog.ts';",
  "it('F-0106 AC-50 (c123-native-dialog): the row', async () => {",
  "  await answerNativeFolderDialog('/f');",
  '});',
].join('\n');

describe('the pinned X11 rows (card #2831)', () => {
  it('#2831: the tree holds exactly the pinned X11 modules and rows, each X11 row wrapped in linuxOnly', () => {
    deepStrictEqual(
      x11Problems(
        sourcesUnder(path.join(REPOSITORY_ROOT, 'tests', 'acceptance')),
      ),
      [],
    );
  });

  it('#2831: an X11 tool in an unpinned file is named', () => {
    deepStrictEqual(
      x11Problems([
        {path: MODULE_PATH, text: MODULE_TEXT},
        {path: ROW_PATH, text: ROW_TEXT_WRAPPED},
        {
          path: 'tests/acceptance/other/x11-dialog.ts',
          text: "spawnSync('xprop');",
        },
      ]),
      [
        'tests/acceptance/other/x11-dialog.ts names xprop but is not a pinned X11 module',
      ],
    );
  });

  it('#2831: a row that drives the display without the wrap is named', () => {
    deepStrictEqual(
      x11Problems([
        {path: MODULE_PATH, text: MODULE_TEXT},
        {path: ROW_PATH, text: ROW_TEXT_UNWRAPPED},
      ]),
      [
        `the row F-0106 AC-50 (c123-native-dialog): the row in ${ROW_PATH} drives the display but is not wrapped in linuxOnly`,
      ],
    );
  });

  it('#2831: a wrap that is not listed is named, and the pinned row it replaced is named too', () => {
    deepStrictEqual(
      x11Problems([
        {path: MODULE_PATH, text: MODULE_TEXT},
        {
          path: ROW_PATH,
          text: "it('F-9999 AC-1 (c9999-other): the row', linuxOnly(async () => {}));",
        },
      ]),
      [
        `the row F-9999 AC-1 (c9999-other): the row in ${ROW_PATH} is wrapped in linuxOnly but is not in the pinned X11 rows`,
        `the pinned X11 row F-0106 AC-50 (c123-native-dialog) is no longer in ${ROW_PATH}`,
      ],
    );
  });

  it('#2831: a row file that imports a pinned module without being pinned is named', () => {
    deepStrictEqual(
      x11Problems([
        {path: MODULE_PATH, text: MODULE_TEXT},
        {
          path: 'tests/acceptance/other/other.test.ts',
          text: [
            "import {answerNativeFolderDialog} from '../containers-trust/native-folder-dialog.ts';",
            "it('F-9998 AC-1 (c9998-x): the row', async () => {",
            "  await answerNativeFolderDialog('/f');",
            '});',
          ].join('\n'),
        },
      ]),
      [
        'tests/acceptance/other/other.test.ts imports a pinned X11 module but is not a pinned X11 row file',
        `the pinned X11 row F-0106 AC-50 (c123-native-dialog) is gone: ${ROW_PATH} is not in the tree`,
      ],
    );
  });

  it('#2831: a pinned module that no longer drives the display is named', () => {
    deepStrictEqual(
      x11Problems([
        {
          path: MODULE_PATH,
          text: [
            'export async function answerNativeFolderDialog(folder: string): Promise<void> {',
            '  await openChooser(folder);',
            '}',
          ].join('\n'),
        },
        {path: ROW_PATH, text: ROW_TEXT_WRAPPED},
      ]),
      [`the pinned X11 module ${MODULE_PATH} no longer drives the display`],
    );
  });
});
