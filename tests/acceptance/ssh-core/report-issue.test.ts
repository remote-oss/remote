/**
 * @fileoverview F-2005's rows (card #2488): each row runs "Remote-SSH: Report Issue..." in its window kind and compares
 * one value of its criterion's clauses against what the window shows. The Issue Reporter is core's auxiliary window,
 * which the harness reaches through the editor's debugging port, the same way the extension-pack rows reach it.
 * AC-6 expands the reporter's system-information row optimistically, to the spec: if the expansion shows another
 * shape, the row's prints say so and the row fails.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {
  connectionLog,
  readUserSettings,
  restoreUserSettings,
  startInWindow,
  userSettings,
  variable,
  windowNames,
} from '../windows/harness.ts';
import {sshActivations, windowWithLog} from '../windows/activation-support.ts';
import {closeAllButLocal, openConnected} from '../windows/maintenance.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {changedKeys, extensionState} from '../windows/global-state.ts';
import {evaluateAt, LONG_READ_MILLISECONDS} from '../windows/page-protocol.ts';
import {paletteItems} from '../windows/palette.ts';
import {
  dialogOf,
  notificationCentre,
  notifications,
  pageOf,
  pageText,
  quickPickOf,
} from '../windows/renderer.ts';
import {emptyLocalWindow} from '../windows/window-states.ts';

/** The repository root, three levels up from this file's directory. */
const REPOSITORY_ROOT = path.join(import.meta.dirname, '..', '..', '..');

/** The host alias the rows connect to, as the run's ssh_config names it. */
const HOST_ALIAS = 'harness';

/**
 * The text of the reporter's form when this command opened it: core's default, with the extension's own
 * preselection and nothing else. The criterion's source label, "A VS Code extension" (AC-3), is core's for the
 * reference's product; the run's product is VSCodium, and its label is "A VSCodium extension".
 */
const OWN_FORM_TEXT =
  'Before you report an issue here please review the guidance we provide. Please complete the form in English.\n' +
  'This is a \n' +
  'Bug Report\n' +
  'Feature Request\n' +
  'Performance Issue (freeze, slow, crash)\n' +
  'For * \n' +
  'Select source\n' +
  'VSCodium\n' +
  'A VSCodium extension\n' +
  "Don't know\n" +
  'Extension * \n' +
  'Select extension\n' +
  'Acceptance window agent\n' +
  'Remote - SSH\n' +
  'Remote - SSH: Editing Configuration Files\n' +
  'Title * \n' +
  'Steps to Reproduce *\n' +
  'Share the steps needed to reliably reproduce the problem. Please include actual and expected results. We support GitHub-flavored Markdown. You will be able to edit your issue and add screenshots when we preview it on GitHub.\n' +
  ' Include my system information (show)\n' +
  ' Include A/B experiment info (show)\n' +
  'Preview on GitHub';

/** The core reporter's own text, before this command preselected anything. */
const CORE_FORM_TEXT =
  'Before you report an issue here please review the guidance we provide. Please complete the form in English.\n' +
  'This is a \n' +
  'Bug Report\n' +
  'Feature Request\n' +
  'Performance Issue (freeze, slow, crash)\n' +
  'For * \n' +
  'Select source\n' +
  'VSCodium\n' +
  'A VSCodium extension\n' +
  "Don't know\n" +
  'Title * \n' +
  'Steps to Reproduce *\n' +
  'Share the steps needed to reliably reproduce the problem. Please include actual and expected results. We support GitHub-flavored Markdown. You will be able to edit your issue and add screenshots when we preview it on GitHub.\n' +
  ' Include my system information (show)\n' +
  ' Include my enabled extensions (show)\n' +
  ' Include A/B experiment info (show)\n' +
  'Preview on GitHub';

/** The lines the wizard's reporter tab shows in the window, per the spec's step one. */
const WIZARD_LINES = [
  'Report Issue',
  'Step 1 of 3',
  'Attachments',
  'Skip',
  'Add attachments for better context',
];

/** A target of the editor's debugging port, as its list reads it. */
interface DebugTarget {
  id: string;
  type: string;
  title: string;
  webSocketDebuggerUrl?: string;
}

/** A select of the reporter's form, as the reporter's page reads it. */
interface ReporterSelect {
  id: string;
  value: string;
  selected: string | null;
  options: string[];
}

/** A field of the reporter's form, as the reporter's page reads it. */
interface ReporterField {
  id: string;
  type: string;
  placeholder: string | null;
  value: string;
  checked: boolean | null;
}

/** The reporter's own page as its form reads it. */
interface ReporterForm {
  title: string;
  text: string;
  selects: ReporterSelect[];
  fields: ReporterField[];
  buttons: string[];
}

/** The rows of the reporter's system-information table, label then value. */
type SystemRows = Array<[string, string]>;

/** One line of the row's measurement to the job's log. */
function print(text: string): void {
  console.log(`c2488 ${text}`);
}

/** The targets the editor's debugging port lists, read from the port file the launch's editor writes. */
async function listedTargets(): Promise<DebugTarget[]> {
  const portFile = path.join(
    variable('HARNESS_USER_DATA'),
    'DevToolsActivePort',
  );
  const port = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
  const answer = await fetch(`http://127.0.0.1:${String(port)}/json/list`);
  return (await answer.json()) as DebugTarget[];
}

/** The listed targets that are the core reporter's auxiliary window. */
function reporterTargets(targets: readonly DebugTarget[]): DebugTarget[] {
  return targets.filter(
    target => target.type === 'page' && target.title === 'Issue Reporter',
  );
}

/** The first Issue Reporter target, waiting for it up to `milliseconds`, or undefined when none opens. */
async function reporterAppears(
  milliseconds: number,
): Promise<DebugTarget | undefined> {
  const deadline = Date.now() + milliseconds;
  for (;;) {
    const targets = await listedTargets().catch(() => []);
    const reporters = reporterTargets(targets);
    if (reporters.length > 0) {
      return reporters[0];
    }
    if (Date.now() > deadline) {
      return undefined;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

/** The reporter's own page as its form reads it: the selects, the fields and the whole visible text. */
const FORM_READ = `(() => {
  const selects = [...document.querySelectorAll('select')].map(select => ({
    id: select.id,
    value: select.value,
    selected: select.options[select.selectedIndex]?.text ?? null,
    options: [...select.options].map(option => option.text),
  }));
  const fields = [...document.querySelectorAll('input, textarea')].map(field => ({
    id: field.id,
    type: field.type,
    placeholder: field.placeholder || null,
    value: field.value,
    checked: field.type === 'checkbox' ? field.checked : null,
  }));
  const buttons = [...document.querySelectorAll('button')].map(button => button.textContent ?? '');
  return {
    title: document.title,
    text: document.body.innerText,
    selects,
    fields,
    buttons,
  };
})()`;

/**
 * Clicks the control that expands the reporter's system-information row, the "show" beside "Include my system
 * information", whose text the page splits across elements, so no leaf element shows it alone: the control is the
 * smallest element that shows the whole of its text, clicked as a user would click the label.
 */
const SYSTEM_TOGGLE = `(() => {
  const controls = [...document.querySelectorAll('*')].filter(element => {
    const text = element.textContent ?? '';
    return text.includes('system information') && text.includes('(show)');
  });
  if (controls.length === 0) {
    return 'no system information show control';
  }
  const control = controls.sort(
    (first, second) =>
      (first.textContent ?? '').length - (second.textContent ?? '').length,
  )[0];
  control.click();
  return 'clicked the ' + control.tagName.toLowerCase();
})()`;

/** The reporter's system-information table as its rows read it, label then value, or the text that is there. */
const SYSTEM_TABLE = `(() => {
  const tables = [...document.querySelectorAll('table')];
  if (tables.length === 0) return 'no table';
  const lines = tables.flatMap(table => [...table.querySelectorAll('tr')].map(tr => [...tr.children].map(cell => (cell.textContent ?? '').trim())));
  if (lines.length === 0) return 'no table rows';
  return JSON.stringify(lines.map(each => [each[0] ?? '', each.slice(1).join(' ')]));
})()`;

/** Reads the reporter's form at protocol address `address`, or undefined when there is no reporter. */
async function reporterForm(
  address: string | undefined,
): Promise<ReporterForm | undefined> {
  if (address === undefined) {
    return undefined;
  }
  return evaluateAt<ReporterForm>(
    address,
    'the Issue Reporter window',
    FORM_READ,
    LONG_READ_MILLISECONDS,
  );
}

/** Closes the reporter at protocol address `address`, where the window's own close control does. */
async function closeReporter(address: string): Promise<void> {
  await evaluateAt(
    address,
    'the Issue Reporter window',
    'window.close(); true',
  ).catch((caught: unknown) => {
    print(`c2488 close the reporter: ${String(caught)}`);
  });
}

/** Closes the reporter the row measured, when it opened one. */
async function closeReported(address: string | undefined): Promise<void> {
  if (address !== undefined) {
    await closeReporter(address);
  }
}

/** Whether the command palette of window `name` lists the command, typing "Remote-SSH: Report". */
async function paletteLists(name: string): Promise<boolean> {
  const items = await paletteItems(name, 'Remote-SSH: Report');
  print(`c2488-palette ${JSON.stringify(name)} lists ${JSON.stringify(items)}`);
  return items.includes('Remote-SSH: Report Issue...');
}

/** The folder `name` of the launch's run, made. */
function folderOf(name: string): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), name);
  mkdirSync(folder, {recursive: true});
  return folder;
}

describe('the Issue Reporter the Report Issue... command opens (card #2488)', function () {
  this.timeout(300_000);

  afterEach(async () => {
    await closeAllButLocal();
  });

  it('F-2005 AC-1 (c2488-palette): "Remote-SSH: Report" lists the command in the palette of a fresh empty window, a local folder window and a connected SSH window', async () => {
    const empty = await emptyLocalWindow();
    const folder = await openFolderWindow(folderOf('c2488-palette-folder'));
    await openConnected('c2488-palette');
    deepStrictEqual(
      {
        empty: await paletteLists(empty),
        folder: await paletteLists(folder),
        connected: await paletteLists('c2488-palette'),
      },
      {empty: true, folder: true, connected: true},
    );
  });

  it('F-2005 AC-2, AC-3, AC-4, AC-5, AC-6, AC-8 (c2488-classic): the classic reporter a connected SSH window opens, its form, its system-information table and a repeat of the command', async () => {
    await openConnected('c2488-classic');
    const main = await pageOf('c2488-classic');
    const titleBefore = await evaluateAt<string>(
      main,
      'c2488-classic',
      'document.title',
    );
    await evaluateAt(main, 'c2488-classic', 'window.c2488Marker = 1; true');
    const logMark = connectionLog().length;
    let address: string | undefined;
    try {
      const sent = Date.now();
      await startInWindow('c2488-classic', 'opensshremotes.reportIssue');
      const reporter = await reporterAppears(10_000);
      const opening = Date.now() - sent;
      print(`c2488-classic windowNames ${JSON.stringify(windowNames())}`);
      print(`c2488-classic the opening took ${String(opening)} ms`);
      address = reporter?.webSocketDebuggerUrl;
      const titleAfter = await evaluateAt<string>(
        main,
        'c2488-classic',
        'document.title',
      );
      const marker = await evaluateAt<number | undefined>(
        main,
        'c2488-classic',
        'window.c2488Marker',
      );
      const form = await reporterForm(address);
      print(`c2488-classic the reporter form ${JSON.stringify(form)}`);
      const toasts = await notifications('c2488-classic');
      const centre = await notificationCentre('c2488-classic');
      const dialog = await dialogOf('c2488-classic');
      const pick = (await quickPickOf('c2488-classic'))?.items ?? null;
      print(
        `c2488-classic the toasts ${JSON.stringify(toasts)} the centre ${JSON.stringify(centre)} the dialog ${JSON.stringify(dialog)} the quick pick ${JSON.stringify(pick)}`,
      );
      const since = connectionLog().slice(logMark);
      print(`c2488-classic the log since the command ${JSON.stringify(since)}`);
      const toggled =
        address === undefined
          ? 'no reporter target'
          : await evaluateAt<string>(
              address,
              'the Issue Reporter window',
              SYSTEM_TOGGLE,
              LONG_READ_MILLISECONDS,
            );
      print(`c2488-classic the system information show ${toggled}`);
      await new Promise(resolve => setTimeout(resolve, 1500));
      const table =
        address === undefined
          ? 'no reporter target'
          : await evaluateAt<string>(
              address,
              'the Issue Reporter window',
              SYSTEM_TABLE,
              LONG_READ_MILLISECONDS,
            );
      print(`c2488-classic the system information table ${table}`);
      const rows =
        table === 'no table' || table === 'no table rows'
          ? undefined
          : (JSON.parse(table) as SystemRows);
      const remote = rows?.find(each => each[0] === 'Remote');
      const remoteValue = remote?.[1] ?? '';
      print(`c2488-classic the Remote row ${JSON.stringify(remote)}`);
      const expanded = await reporterForm(address);
      print(
        `c2488-classic the form after the expansion ${JSON.stringify({text: expanded?.text.slice(0, 1200)})}`,
      );
      const before = reporterTargets(await listedTargets()).length;
      await startInWindow('c2488-classic', 'opensshremotes.reportIssue');
      await new Promise(resolve => setTimeout(resolve, 8000));
      const after = reporterTargets(await listedTargets());
      const repeated = await reporterForm(after[0]?.webSocketDebuggerUrl);
      print(
        `c2488-classic the reporters ${JSON.stringify([before, after.length])} the form after the repeat ${JSON.stringify({text: repeated?.text.slice(0, 1200)})}`,
      );
      const source = form?.selects.find(select => select.id === 'issue-source');
      const extension = form?.selects.find(
        select => select.id === 'extension-selector',
      );
      const title = form?.fields.find(field => field.id === 'issue-title');
      const description = form?.fields.find(
        field => field.id === 'description',
      );
      deepStrictEqual(
        {
          reporter: reporter !== undefined,
          openingWithinTenSeconds: opening <= 10_000,
          titleUnchanged: titleBefore === titleAfter,
          marker,
          formTitle: form?.title,
          formText: form?.text,
          source: {value: source?.value, selected: source?.selected},
          extension: {value: extension?.value, selected: extension?.selected},
          title: {value: title?.value, placeholder: title?.placeholder},
          description: {
            value: description?.value,
            placeholder: description?.placeholder,
          },
          toasts,
          centre,
          dialog,
          pick,
          connectionLog: since,
          remoteMatchesHost: remoteValue.startsWith(`SSH: ${HOST_ALIAS}`),
          repeat: [before, after.length],
          repeatUnchanged: repeated?.text === expanded?.text,
        },
        {
          reporter: true,
          openingWithinTenSeconds: true,
          titleUnchanged: true,
          marker: 1,
          formTitle: 'Issue Reporter',
          formText: OWN_FORM_TEXT,
          source: {value: 'extension', selected: 'A VSCodium extension'},
          extension: {
            value: 'remote-oss.remote-ssh',
            selected: 'Remote - SSH',
          },
          title: {value: '', placeholder: 'Please enter a title.'},
          description: {value: '', placeholder: 'Please enter details.'},
          toasts: [],
          centre: [],
          dialog: undefined,
          pick: null,
          connectionLog: [],
          remoteMatchesHost: true,
          repeat: [1, 1],
          repeatUnchanged: true,
        },
      );
    } finally {
      await closeReported(address);
    }
  });

  it("F-2005 AC-9 (c2488-helpfirst): the reporter core's own Report Issue... opened first, then this command, and the source the open reporter keeps", async () => {
    await openConnected('c2488-helpfirst');
    let address: string | undefined;
    try {
      await startInWindow(
        'c2488-helpfirst',
        'workbench.action.openIssueReporter',
      );
      const first = await reporterAppears(20_000);
      address = first?.webSocketDebuggerUrl;
      const coreForm = await reporterForm(address);
      print(
        `c2488-helpfirst the core reporter form ${JSON.stringify(coreForm)}`,
      );
      await startInWindow('c2488-helpfirst', 'opensshremotes.reportIssue');
      await new Promise(resolve => setTimeout(resolve, 8000));
      const after = reporterTargets(await listedTargets());
      const kept = await reporterForm(after[0]?.webSocketDebuggerUrl);
      const source = kept?.selects.find(select => select.id === 'issue-source');
      const extension = kept?.selects.find(
        select => select.id === 'extension-selector',
      );
      print(
        `c2488-helpfirst the reporters after this command ${String(after.length)} the form ${JSON.stringify({text: kept?.text.slice(0, 1200)})}`,
      );
      deepStrictEqual(
        {
          coreOpened: first !== undefined,
          coreText: coreForm?.text,
          reportersAfter: after.length,
          sourceKept: source?.selected,
          extensionKept: extension?.selected,
        },
        {
          coreOpened: true,
          coreText: CORE_FORM_TEXT,
          reportersAfter: 1,
          sourceKept: 'Select source',
          extensionKept: 'Select extension',
        },
      );
    } finally {
      await closeReported(address);
    }
  });

  it("F-2005 AC-10 (c2488-wizard): with the core wizard enabled, the command's reporter in the window's own editor tab, not an auxiliary window", async () => {
    const saved = readUserSettings();
    await userSettings({issueReporter: {wizard: {enabled: true}}});
    try {
      await openConnected('c2488-wizard');
      await startInWindow('c2488-wizard', 'opensshremotes.reportIssue');
      await new Promise(resolve => setTimeout(resolve, 15_000));
      const targets = (await listedTargets()).map(target => target.title);
      const text = await pageText('c2488-wizard');
      print(
        `c2488-wizard the targets ${JSON.stringify(targets)} the window text ${JSON.stringify(text.slice(0, 2000))}`,
      );
      deepStrictEqual(
        {
          auxiliary: reporterTargets(await listedTargets()).length,
          missing: WIZARD_LINES.filter(line => !text.includes(line)),
        },
        {auxiliary: 0, missing: []},
      );
    } finally {
      restoreUserSettings(saved);
    }
  });

  it('F-2005 AC-7 (c2488-activate): the command in a fresh empty window, the activation it causes and the reporter it opens', async () => {
    const {name, logFile} = await windowWithLog(emptyLocalWindow);
    const before = sshActivations(logFile);
    const logMark = connectionLog().length;
    let address: string | undefined;
    try {
      await startInWindow(name, 'opensshremotes.reportIssue');
      const reporter = await reporterAppears(20_000);
      address = reporter?.webSocketDebuggerUrl;
      const after = sshActivations(logFile);
      const since = connectionLog().slice(logMark);
      const form = await reporterForm(address);
      print(
        `c2488-activate the activations ${JSON.stringify([before, after])} the log since the command ${JSON.stringify(since)} the reporter form ${JSON.stringify(form)}`,
      );
      deepStrictEqual(
        {
          activationsBefore: before,
          reporter: reporter !== undefined,
          activationsAfter: after,
          connectionLog: since,
          formTitle: form?.title,
          formText: form?.text,
        },
        {
          activationsBefore: [],
          reporter: true,
          activationsAfter: ['onCommand:opensshremotes.reportIssue'],
          connectionLog: [
            'Log level: debug',
            'Editor version: 1.140.0',
            'remote-ssh 0.1.0',
            'Client: linux x64',
          ],
          formTitle: 'Issue Reporter',
          formText: OWN_FORM_TEXT,
        },
      );
    } finally {
      await closeReported(address);
    }
  });

  it('F-2005 AC-12 (c2488-execute): the command run by executeCommand in a connected SSH window, its state, storage and settings footprint', async () => {
    await openConnected('c2488-execute');
    const main = await pageOf('c2488-execute');
    const titleBefore = await evaluateAt<string>(
      main,
      'c2488-execute',
      'document.title',
    );
    const storage = path.join(
      variable('HARNESS_USER_DATA'),
      'User',
      'globalStorage',
    );
    const storageBefore = readdirSync(storage)
      .filter(entry => entry !== 'state.vscdb-journal')
      .sort();
    const settingsBefore = readUserSettings();
    const stateBefore = await extensionState();
    const targetsBefore = (await listedTargets())
      .map(target => target.id)
      .sort();
    const logMark = connectionLog().length;
    let address: string | undefined;
    try {
      await startInWindow('c2488-execute', 'opensshremotes.reportIssue');
      const reporter = await reporterAppears(20_000);
      address = reporter?.webSocketDebuggerUrl;
      const storageAfter = readdirSync(storage)
        .filter(entry => entry !== 'state.vscdb-journal')
        .sort();
      const settingsAfter = readUserSettings();
      const stateAfter = await extensionState();
      const fresh = (await listedTargets())
        .filter(target => !targetsBefore.includes(target.id))
        .map(target => target.title)
        .sort();
      const titleAfter = await evaluateAt<string>(
        main,
        'c2488-execute',
        'document.title',
      );
      const since = connectionLog().slice(logMark);
      print(
        `c2488-execute the reporter ${String(reporter !== undefined)} the storage diff ${JSON.stringify({added: storageAfter.filter(entry => !storageBefore.includes(entry)), removed: storageBefore.filter(entry => !storageAfter.includes(entry))})} the new targets ${JSON.stringify(fresh)} the changed state keys ${JSON.stringify(changedKeys(stateBefore, stateAfter))} the log since the command ${JSON.stringify(since)}`,
      );
      deepStrictEqual(
        {
          reporter: reporter !== undefined,
          storageAdded: storageAfter.filter(
            entry => !storageBefore.includes(entry),
          ),
          storageRemoved: storageBefore.filter(
            entry => !storageAfter.includes(entry),
          ),
          settingsUnchanged: settingsAfter === settingsBefore,
          stateKeysChanged: changedKeys(stateBefore, stateAfter),
          newTargets: fresh,
          titleUnchanged: titleBefore === titleAfter,
          connectionLog: since,
        },
        {
          reporter: true,
          storageAdded: [],
          storageRemoved: [],
          settingsUnchanged: true,
          stateKeysChanged: [],
          newTargets: ['Issue Reporter'],
          titleUnchanged: true,
          connectionLog: [],
        },
      );
    } finally {
      await closeReported(address);
    }
  });

  it("F-2005 AC-11 (c2488-manifest): the manifest's bugs.url and repository.url name the reimplementation's own tracker, not a Microsoft repository", () => {
    const manifest = JSON.parse(
      readFileSync(
        path.join(REPOSITORY_ROOT, 'packages', 'remote-ssh', 'package.json'),
        'utf8',
      ),
    ) as {bugs: {url: string}; repository: {url: string}};
    print(
      `c2488-manifest the manifest ${JSON.stringify({bugs: manifest.bugs, repository: manifest.repository})}`,
    );
    deepStrictEqual(
      {bugs: manifest.bugs.url, repository: manifest.repository.url},
      {
        bugs: 'https://github.com/remote-oss/remote/issues',
        repository: 'https://github.com/remote-oss/remote.git',
      },
    );
  });
});
