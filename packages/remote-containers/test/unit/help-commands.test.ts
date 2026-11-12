/**
 * @fileoverview The four help commands: each opens its address or the issue reporter, the same every time, and shows
 * nothing of its own.
 */

import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  HELP_LINKS,
  helpHandlers,
  type IssueReport,
} from '../../src/help/help-commands.ts';

describe('the help commands (card containers-218)', () => {
  const BODY = 'For bug reports please include the log.';

  function sceneOf(reject?: Error): {
    opened: string[];
    reports: IssueReport[];
    sink: MemorySink;
    execute: (
      name: 'getHelp' | 'getStarted' | 'provideFeedback' | 'reportIssue',
    ) => Promise<unknown>;
  } {
    const opened: string[] = [];
    const reports: IssueReport[] = [];
    const sink = new MemorySink();
    const handlers = helpHandlers(
      {
        openExternal: address => {
          opened.push(address);
          return Promise.resolve(true);
        },
        openIssueReporter: report => {
          reports.push(report);
          return reject === undefined
            ? Promise.resolve()
            : Promise.reject(reject);
        },
      },
      'remote-oss.remote-containers',
      BODY,
      createLogger(sink, {minimumLevel: () => 'info'}),
    );
    return {
      opened,
      reports,
      sink,
      execute: name => Promise.resolve(handlers[name].execute()),
    };
  }

  it('F-0105 AC-1, AC-2, AC-4, AC-25: Help, Get Started and Provide Feedback hand their address to the opener and nothing else', async () => {
    const scene = sceneOf();
    await scene.execute('getHelp');
    await scene.execute('getStarted');
    await scene.execute('provideFeedback');
    deepStrictEqual(
      [scene.opened, scene.reports, scene.sink.lines.length],
      [
        [HELP_LINKS.documentation, HELP_LINKS.getStarted, HELP_LINKS.feedback],
        [],
        0,
      ],
    );
  });

  it('F-0105 AC-10: running a command again does the same again', async () => {
    const scene = sceneOf();
    await scene.execute('getHelp');
    await scene.execute('getHelp');
    deepStrictEqual(scene.opened, [
      HELP_LINKS.documentation,
      HELP_LINKS.documentation,
    ]);
  });

  it('F-0105 AC-6: Report Issue opens the reporter for the extension with the text that asks for the log, and no address', async () => {
    const scene = sceneOf();
    await scene.execute('reportIssue');
    deepStrictEqual(
      [scene.opened, scene.reports],
      [[], [{extensionId: 'remote-oss.remote-containers', issueBody: BODY}]],
    );
  });

  it('F-0105 7.E2: a reporter the editor does not have is logged and shows nothing', async () => {
    const scene = sceneOf(new Error('command not found'));
    await scene.execute('reportIssue');
    deepStrictEqual(
      scene.sink.lines.map(line => line.message.includes('command not found')),
      [true],
    );
  });
});
