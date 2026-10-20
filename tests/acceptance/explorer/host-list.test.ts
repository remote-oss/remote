/**
 * @fileoverview The hosts the SSH group lists for a configuration file (card coverage-25c, part b): one row per case,
 * each with its own file named by `remote.SSH.configFile`, so only that file's hosts are listed (F-5102 BR-9), read
 * after Refresh in a folder window of its own.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closeWindow,
  inWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  variable,
} from '../windows/harness.ts';
import {
  labelCut,
  notifications,
  rowDetails,
  titleAction,
} from '../windows/renderer.ts';
import {rowsOf, rowsSettled, VIEW} from '../windows/explorer-rows.ts';

/** The rows the main flow's configuration gives (F-5102 5.0 step 2), without the system file's hosts. */
const MAIN_FLOW_HOSTS = [
  'zeta-box',
  'alpha-hostname-only',
  'Mixed-Case-Host',
  'multi-one',
  'multi-two',
  'included-after-neg',
  'quoted host',
  '10.0.0.5',
  'matchbox',
  'beta-after-match',
];

/** The main flow's configuration file (F-5102 5.0 step 2). */
const MAIN_FLOW_FILE = [
  'Host zeta-box',
  '    HostName 127.0.0.1',
  '    User f5102',
  '    Port 2201',
  'Host alpha-hostname-only',
  '    HostName alpha.example.invalid',
  'Host Mixed-Case-Host',
  'Host multi-one multi-two',
  'Host dev-*',
  'Host ?x',
  'Host !excluded included-after-neg',
  'Host "quoted host"',
  'Host 10.0.0.5',
  'Match host matchbox exec "true"',
  'Host beta-after-match',
  'Host *',
];

/** An alias longer than the side bar is wide. */
const LONG_ALIAS = `long-${'x'.repeat(160)}`;

/** The folder of the cases' files, made once. */
function casesFolder(): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'host-list');
  mkdirSync(folder, {recursive: true});
  return folder;
}

/** Writes `lines` to `name` in the cases' folder and gives its path. */
function written(name: string, lines: readonly string[]): string {
  const file = path.join(casesFolder(), name);
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

describe('the hosts of a configuration file in the SSH group (card coverage-25c, part b)', function () {
  this.timeout(240_000);
  let window = '';
  let savedSettings: string | undefined;

  before(async () => {
    savedSettings = readUserSettings();
    const folder = path.join(casesFolder(), 'host-list-window');
    mkdirSync(folder, {recursive: true});
    window = await openFolderWindow(folder);
    await inWindow(window, 'workbench.view.remote');
  });

  after(async () => {
    restoreUserSettings(savedSettings);
    await closeWindow(window);
  });

  /** Names `file` as the configuration and refreshes, then waits until the group lists exactly `hosts`. */
  async function listed(file: string, hosts: readonly string[]): Promise<void> {
    await userSettings({'remote.SSH.configFile': file});
    await titleAction(window, VIEW, 'Refresh');
    await rowsSettled(window, rowsOf([...hosts], undefined));
  }

  it('F-5102 AC-4 (host-rows): each alias is a vm row with no description, and its HostName, User and Port show nowhere', async () => {
    await listed(
      written('ac4.conf', [
        'Host zeta-box',
        '    HostName 10.98.76.54',
        '    User zuser',
        '    Port 2299',
        'Host multi-one multi-two',
      ]),
      ['zeta-box', 'multi-one', 'multi-two'],
    );
    const hostRows = (await rowDetails(window, VIEW))?.slice(1) ?? [];
    deepStrictEqual(
      hostRows.map(hostRow => [
        hostRow.icon,
        hostRow.description,
        ['10.98.76.54', 'zuser', '2299'].some(detail =>
          hostRow.ariaLabel.includes(detail),
        ),
      ]),
      [
        ['vm', '', false],
        ['vm', '', false],
        ['vm', '', false],
      ],
    );
  });

  it('F-5102 AC-6 (patterns): no row for a pattern, a negation or a Match criterion that is not a concrete host, and rows for the concrete names in file order', async () => {
    await listed(
      written('ac6.conf', [
        ...MAIN_FLOW_FILE,
        'Host a*b concrete-after-wild',
        'Match host m-one,m-two',
        'Match user someone',
        'Match all',
        'Match host m-wild*,m-plain',
      ]),
      [...MAIN_FLOW_HOSTS, 'concrete-after-wild', 'm-one,m-two'],
    );
  });

  it('F-5102 AC-7 (duplicates): a duplicated alias has one row at its first place, also across an Include, and the case of an alias stays as written', async () => {
    const included = written('ac7-included.conf', [
      'Host inc-dup',
      'Host inc-only',
    ]);
    await listed(
      written('ac7.conf', [
        `Include ${included}`,
        'Host dup-one',
        'Host Mixed-Case-Host',
        'Host dup-one',
        'Host UPPER-host',
        'Host inc-dup',
      ]),
      ['dup-one', 'Mixed-Case-Host', 'UPPER-host', 'inc-dup', 'inc-only'],
    );
  });

  it("F-5102 AC-8 (include-order): the file's own hosts come first, then an Include's wildcard files in reverse name order, and an Include after a Host line adds nothing", async () => {
    written('ac8.d/10-a.conf', ['Host ten-a']);
    written('ac8.d/20-b.conf', ['Host twenty-b']);
    written('ac8.d/30-c.conf', ['Host thirty-c']);
    const late = written('ac8-late.conf', ['Host late-host']);
    await listed(
      written('ac8.conf', [
        `Include ${path.join(casesFolder(), 'ac8.d')}/*.conf`,
        'Host own-one',
        'Host own-two',
        `Include ${late}`,
      ]),
      ['own-one', 'own-two', 'thirty-c', 'twenty-b', 'ten-a'],
    );
  });

  it('F-5102 AC-26 (odd-lines): a missing Include, free text, a HostName before any Host, a bad Port and other keyword forms show no notification and every concrete alias, and a Host line with no pattern ends the list', async () => {
    const oddLines = [
      `Include ${path.join(casesFolder(), 'ac26-missing.conf')}`,
      'this is free text',
      'HostName before-any-host',
      'Host port-bad',
      '    Port notanumber',
      'host lower-keyword',
      'HOST=equals-keyword',
      'Host tab-one\ttab-two',
    ];
    const expected = [
      'port-bad',
      'lower-keyword',
      'equals-keyword',
      'tab-one',
      'tab-two',
    ];
    await listed(written('ac26.conf', oddLines), expected);
    await listed(
      written('ac26-empty-host.conf', [
        ...oddLines,
        'Host',
        'Host after-empty',
      ]),
      expected,
    );
    deepStrictEqual(await notifications(window), []);
  });

  it('F-5102 AC-31 (long-alias): an alias wider than the pane is cut, and a non-ASCII alias is shown as written', async () => {
    await listed(
      written('ac31.conf', [`Host ${LONG_ALIAS}`, 'Host hôte-ünïcode']),
      [LONG_ALIAS, 'hôte-ünïcode'],
    );
    deepStrictEqual(
      [
        await labelCut(window, VIEW, LONG_ALIAS),
        await labelCut(window, VIEW, 'hôte-ünïcode'),
      ],
      [true, false],
    );
  });

  it('F-5102 AC-41 (odd-names): addresses, a scope id, dots, an @, trailing spaces and a tab give rows in file order', async () => {
    await listed(
      written('ac41.conf', [
        'Host ::1',
        'Host fe80::1%eth0',
        'Host host.with.dots',
        'Host user@weird',
        'Host trailing-spaces   ',
        'Host tab\tseparated',
      ]),
      [
        '::1',
        'fe80::1%eth0',
        'host.with.dots',
        'user@weird',
        'trailing-spaces',
        'tab',
        'separated',
      ],
    );
  });

  it('F-5102 AC-43 (match-host): Match Host and Match canonical host give rows, and Match originalhost gives none', async () => {
    await listed(
      written('ac43.conf', [
        'Match Host m-cap',
        'Match canonical host m-canon',
        'Match originalhost m-orig',
      ]),
      ['m-cap', 'm-canon'],
    );
  });

  it('F-5102 AC-45 (editor-write): a host added to an included file through the editor is listed after Refresh', async () => {
    const included = written('ac45-included.conf', ['Host inc-before']);
    const file = written('ac45.conf', [`Include ${included}`, 'Host own-host']);
    await listed(file, ['own-host', 'inc-before']);
    await inWindow(
      window,
      'acceptance.agent.writeFile',
      pathToFileURL(included).href,
      'Host inc-before\nHost inc-added\n',
    );
    await listed(file, ['own-host', 'inc-before', 'inc-added']);
  });

  it('F-5102 AC-49 (nested-include): an Include inside an included Host block adds no row', async () => {
    const third = written('ac49-third.conf', ['Host nested-host']);
    const included = written('ac49-included.conf', [
      'Host inc-a',
      `    Include ${third}`,
    ]);
    await listed(
      written('ac49.conf', [`Include ${included}`, 'Host main-own']),
      ['main-own', 'inc-a'],
    );
  });
});
