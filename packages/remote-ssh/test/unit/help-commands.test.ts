import {deepStrictEqual} from 'node:assert';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {
  type HelpEditor,
  type HelpHandlers,
  helpHandlers,
  helpLinksOf,
  type HelpManifest,
} from '../../src/help-commands.ts';

const LINKS = {
  documentation: 'https://example.invalid/docs',
  getStarted: 'https://example.invalid/start',
  feedback: 'https://example.invalid/feedback',
};

const EXTENSION = {
  id: 'remote-oss.remote-ssh',
  pack: ['remote-oss.remote-ssh-edit', 'remote-oss.remote-explorer'],
};

/** Runs one handler of a fresh set and returns what the editor was asked to do. */
function calls(name: keyof HelpHandlers): string[] {
  const asked: string[] = [];
  const editor: HelpEditor = {
    openExternal: address => {
      asked.push(`external ${address}`);
      return Promise.resolve();
    },
    openSettings: filter => {
      asked.push(`settings ${filter}`);
      return Promise.resolve();
    },
    openIssueReporter: extensionId => {
      asked.push(`reporter ${extensionId}`);
      return Promise.resolve();
    },
  };
  void helpHandlers(editor, LINKS, EXTENSION)[name].execute();
  return asked;
}

describe('the help commands', () => {
  it('Help opens the documentation address', () => {
    deepStrictEqual(calls('getHelp'), [
      'external https://example.invalid/docs',
    ]);
  });

  it('Get Started opens the getting started address', () => {
    deepStrictEqual(calls('getStarted'), [
      'external https://example.invalid/start',
    ]);
  });

  it('Provide Feedback opens the feedback address', () => {
    deepStrictEqual(calls('provideFeedback'), [
      'external https://example.invalid/feedback',
    ]);
  });

  it('Settings filters on the extension first and then its pack in order, without spaces', () => {
    deepStrictEqual(calls('settings'), [
      'settings @ext:remote-oss.remote-ssh,remote-oss.remote-ssh-edit,remote-oss.remote-explorer',
    ]);
  });

  it('Report Issue targets the extension itself and none of its pack', () => {
    deepStrictEqual(calls('reportIssue'), ['reporter remote-oss.remote-ssh']);
  });

  it('opens the address again each time it runs', () => {
    const asked: string[] = [];
    const handlers = helpHandlers(
      {
        openExternal: address => {
          asked.push(address);
          return Promise.resolve();
        },
        openSettings: () => Promise.resolve(),
        openIssueReporter: () => Promise.resolve(),
      },
      LINKS,
      EXTENSION,
    );
    void handlers.getHelp.execute();
    void handlers.getHelp.execute();
    deepStrictEqual(asked, [LINKS.documentation, LINKS.documentation]);
  });
});

const PACKAGE = path.join(import.meta.dirname, '..', '..');
const REPOSITORY = path.join(PACKAGE, '..', '..');

function manifestOfPackage(): HelpManifest {
  return JSON.parse(
    readFileSync(path.join(PACKAGE, 'package.json'), 'utf8'),
  ) as HelpManifest;
}

/** The file or folder of this repository that a help address on its web host names. */
function pageOf(address: string): string {
  const [, page] = /\/(?:blob|tree)\/main\/(.+)$/.exec(address) ?? [];
  return path.join(REPOSITORY, page ?? '');
}

/** The message of the error the manifest earns, or the empty text when it earns none. */
function failureOf(manifest: HelpManifest): string {
  try {
    helpLinksOf(manifest);
    return '';
  } catch (caught) {
    return caught instanceof Error ? caught.message : String(caught);
  }
}

describe('the help addresses of the manifest', () => {
  it('are the three the commands open', () => {
    const links = helpLinksOf(manifestOfPackage());
    deepStrictEqual(Object.keys(links).sort(), [
      'documentation',
      'feedback',
      'getStarted',
    ]);
  });

  it('name pages that exist in this repository: the guide folder and the getting-started page', () => {
    const links = helpLinksOf(manifestOfPackage());
    deepStrictEqual(
      [
        existsSync(path.join(pageOf(links.documentation), 'README.md')),
        existsSync(pageOf(links.getStarted)),
      ],
      [true, true],
    );
  });

  it('fail, naming the address, when the manifest names none or an empty one', () => {
    const empty = {
      contributes: {remoteHelp: {'ssh-remote': {urls: {documentation: ''}}}},
    };
    deepStrictEqual([{}, empty].map(failureOf), [
      'the manifest names no documentation address for ssh-remote',
      'the manifest names no documentation address for ssh-remote',
    ]);
  });
});
