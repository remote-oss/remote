/**
 * @fileoverview F-2005's rows in their first pass (card #2488): each row measures what "Remote-SSH: Report Issue..."
 * does in its window kind and prints the measurement to the job's log, so the expected values of the rows can be
 * written to what the window shows. The Issue Reporter is core's auxiliary window, which the harness reaches through
 * the editor's debugging port, the same way the extension-pack rows reach it.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync, readdirSync} from 'node:fs';
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

/** The HTML around the reporter's system-information row, where its "show" control sits. */
const SYSTEM_READ = `(() => {
  const leaf = [...document.querySelectorAll('*')].find(element => element.childElementCount === 0 && (element.textContent ?? '').includes('Include my system information'));
  if (leaf === undefined) return 'no system information row';
  let region = leaf;
  for (let up = 0; up < 4 && region.parentElement !== null; up += 1) region = region.parentElement;
  return region.outerHTML.slice(0, 6000);
})()`;

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

describe('the Issue Reporter the Report Issue... command opens (card #2488)', function () {
  this.timeout(300_000);

  afterEach(async () => {
    await closeAllButLocal();
  });

  it('F-2005 AC-1 (c2488-palette): "Remote-SSH: Report" lists the command in the palette of a fresh empty window and of a connected SSH window', async () => {
    const empty = await emptyLocalWindow();
    print(
      `c2488-palette the empty window lists ${JSON.stringify(await paletteItems(empty, 'Remote-SSH: Report'))}`,
    );
    await openConnected('c2488-palette');
    print(
      `c2488-palette the SSH window lists ${JSON.stringify(await paletteItems('c2488-palette', 'Remote-SSH: Report'))}`,
    );
  });

  it("F-2005 AC-2, AC-3, AC-4, AC-5, AC-6, AC-8 (c2488-classic): the classic reporter a connected SSH window opens, its form, its system-information row and a repeat of the command, measured on the reporter's own page", async () => {
    await openConnected('c2488-classic');
    const titlesBefore = (await listedTargets()).map(target => target.title);
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
      const reporter = await reporterAppears(20_000);
      print(
        `c2488-classic the reporter within 20 s: ${String(reporter !== undefined)}`,
      );
      print(`c2488-classic the opening took ${String(Date.now() - sent)} ms`);
      print(`c2488-classic windowNames ${JSON.stringify(windowNames())}`);
      print(`c2488-classic the targets before ${JSON.stringify(titlesBefore)}`);
      print(
        `c2488-classic the targets after ${JSON.stringify((await listedTargets()).map(target => target.title))}`,
      );
      print(
        `c2488-classic the main title before and after ${JSON.stringify([titleBefore, await evaluateAt<string>(main, 'c2488-classic', 'document.title')])}`,
      );
      print(
        `c2488-classic the page marker after ${String(await evaluateAt<number | undefined>(main, 'c2488-classic', 'window.c2488Marker'))}`,
      );
      if (reporter?.webSocketDebuggerUrl !== undefined) {
        address = reporter.webSocketDebuggerUrl;
        print(
          `c2488-classic the reporter form ${JSON.stringify(await evaluateAt<ReporterForm>(address, 'the Issue Reporter window', FORM_READ, LONG_READ_MILLISECONDS))}`,
        );
        print(
          `c2488-classic the system information row ${await evaluateAt<string>(address, 'the Issue Reporter window', SYSTEM_READ, LONG_READ_MILLISECONDS)}`,
        );
      }
      print(
        `c2488-classic the toasts ${JSON.stringify(await notifications('c2488-classic'))}`,
      );
      print(
        `c2488-classic the centre ${JSON.stringify(await notificationCentre('c2488-classic'))}`,
      );
      print(
        `c2488-classic the dialog ${JSON.stringify(await dialogOf('c2488-classic'))}`,
      );
      print(
        `c2488-classic the quick pick ${JSON.stringify((await quickPickOf('c2488-classic'))?.items ?? null)}`,
      );
      print(
        `c2488-classic the log since the command ${JSON.stringify(connectionLog().slice(logMark))}`,
      );
      const before = reporterTargets(await listedTargets()).length;
      await startInWindow('c2488-classic', 'opensshremotes.reportIssue');
      await new Promise(resolve => setTimeout(resolve, 8000));
      const after = reporterTargets(await listedTargets());
      print(
        `c2488-classic the reporters before and after the repeat ${JSON.stringify([before, after.length])}`,
      );
      if (after.length > 0 && after[0]?.webSocketDebuggerUrl !== undefined) {
        const form = await evaluateAt<ReporterForm>(
          after[0].webSocketDebuggerUrl,
          'the Issue Reporter window',
          FORM_READ,
          LONG_READ_MILLISECONDS,
        );
        print(
          `c2488-classic the form after the repeat ${JSON.stringify({text: form.text.slice(0, 1200)})}`,
        );
      }
    } finally {
      await closeReported(address);
    }
  });

  it("F-2005 AC-9 (c2488-helpfirst): the reporter core's own Report Issue... opened first, then this command, and the source the open reporter keeps, measured", async () => {
    await openConnected('c2488-helpfirst');
    let address: string | undefined;
    try {
      await startInWindow(
        'c2488-helpfirst',
        'workbench.action.openIssueReporter',
      );
      const first = await reporterAppears(20_000);
      print(`c2488-helpfirst the core reporter ${String(first !== undefined)}`);
      if (first?.webSocketDebuggerUrl !== undefined) {
        address = first.webSocketDebuggerUrl;
        print(
          `c2488-helpfirst the core reporter form ${JSON.stringify(await evaluateAt<ReporterForm>(address, 'the Issue Reporter window', FORM_READ, LONG_READ_MILLISECONDS))}`,
        );
      }
      await startInWindow('c2488-helpfirst', 'opensshremotes.reportIssue');
      await new Promise(resolve => setTimeout(resolve, 8000));
      const after = reporterTargets(await listedTargets());
      print(
        `c2488-helpfirst the reporters after this command ${String(after.length)}`,
      );
      if (after.length > 0 && after[0]?.webSocketDebuggerUrl !== undefined) {
        print(
          `c2488-helpfirst the form after this command ${JSON.stringify(await evaluateAt<ReporterForm>(after[0].webSocketDebuggerUrl, 'the Issue Reporter window', FORM_READ, LONG_READ_MILLISECONDS))}`,
        );
      }
    } finally {
      await closeReported(address);
    }
  });

  it("F-2005 AC-10 (c2488-wizard): with the core wizard enabled, the command's reporter in the window's own editor tab, measured", async () => {
    const saved = readUserSettings();
    await userSettings({issueReporter: {wizard: {enabled: true}}});
    try {
      await openConnected('c2488-wizard');
      const titlesBefore = (await listedTargets()).map(target => target.title);
      await startInWindow('c2488-wizard', 'opensshremotes.reportIssue');
      const deadline = Date.now() + 20_000;
      let titles: string[] = titlesBefore;
      while (Date.now() < deadline) {
        titles = (await listedTargets()).map(target => target.title);
        if (titles.some(title => title.includes('Report Issue'))) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      const main = await pageOf('c2488-wizard');
      print(`c2488-wizard the targets ${JSON.stringify(titles)}`);
      print(
        `c2488-wizard the main title ${await evaluateAt<string>(main, 'c2488-wizard', 'document.title')}`,
      );
      print(
        `c2488-wizard the window text ${(await pageText('c2488-wizard')).slice(0, 4000)}`,
      );
    } finally {
      restoreUserSettings(saved);
    }
  });

  it('F-2005 AC-7 (c2488-activate): the command in a fresh empty window, the activation it causes and the reporter it opens, measured', async () => {
    const {name, logFile} = await windowWithLog(emptyLocalWindow);
    print(
      `c2488-activate the activations before ${JSON.stringify(sshActivations(logFile))}`,
    );
    const logMark = connectionLog().length;
    let address: string | undefined;
    try {
      await startInWindow(name, 'opensshremotes.reportIssue');
      const reporter = await reporterAppears(20_000);
      print(`c2488-activate the reporter ${String(reporter !== undefined)}`);
      print(
        `c2488-activate the activations after ${JSON.stringify(sshActivations(logFile))}`,
      );
      print(
        `c2488-activate the log since the command ${JSON.stringify(connectionLog().slice(logMark))}`,
      );
      if (reporter?.webSocketDebuggerUrl !== undefined) {
        address = reporter.webSocketDebuggerUrl;
        print(
          `c2488-activate the reporter form ${JSON.stringify(await evaluateAt<ReporterForm>(address, 'the Issue Reporter window', FORM_READ, LONG_READ_MILLISECONDS))}`,
        );
      }
    } finally {
      await closeReported(address);
    }
  });

  it('F-2005 AC-12 (c2488-execute): the command run by executeCommand in a connected SSH window, its state, storage and settings footprint, measured', async () => {
    await openConnected('c2488-execute');
    const storage = path.join(
      variable('HARNESS_USER_DATA'),
      'User',
      'globalStorage',
    );
    const storageBefore = readdirSync(storage)
      .filter(entry => entry !== 'state.vscdb-journal')
      .sort();
    const settingsBefore = readUserSettings();
    const targetsBefore = (await listedTargets())
      .map(target => target.id)
      .sort();
    const logMark = connectionLog().length;
    let address: string | undefined;
    try {
      await startInWindow('c2488-execute', 'opensshremotes.reportIssue');
      const reporter = await reporterAppears(20_000);
      print(`c2488-execute the reporter ${String(reporter !== undefined)}`);
      if (reporter?.webSocketDebuggerUrl !== undefined) {
        address = reporter.webSocketDebuggerUrl;
      }
      const storageAfter = readdirSync(storage)
        .filter(entry => entry !== 'state.vscdb-journal')
        .sort();
      const targetsAfter = (await listedTargets())
        .map(target => target.id)
        .sort();
      print(
        `c2488-execute the storage diff ${JSON.stringify({added: storageAfter.filter(entry => !storageBefore.includes(entry)), removed: storageBefore.filter(entry => !storageAfter.includes(entry))})}`,
      );
      print(
        `c2488-execute the settings unchanged ${String(readUserSettings() === settingsBefore)}`,
      );
      print(
        `c2488-execute the new targets ${JSON.stringify(targetsAfter.filter(target => !targetsBefore.includes(target)))}`,
      );
      print(
        `c2488-execute the log since the command ${JSON.stringify(connectionLog().slice(logMark))}`,
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
