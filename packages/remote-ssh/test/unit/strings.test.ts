import {deepStrictEqual} from 'node:assert';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';

const BUNDLES = path.join(import.meta.dirname, '..', '..', 'l10n');

const WARNING =
  'Remote - SSH stays inactive in this window because another extension that provides SSH remotes is enabled. Both use the same commands and settings. Disable one of the two and reload the window.';
const BUTTON = 'Show Other Extension';

const SETUP_TEXTS = [
  "{0} needs proposed VS Code APIs that {1} has not enabled for it. Add {2} to 'enable-proposed-api' in argv.json, then restart {1}.",
  "The previous setup attempt did not enable the proposed APIs {0} needs. Check that 'enable-proposed-api' in argv.json lists 'remote-oss.remote-ssh', then restart {1}.",
  'Quit and start {1} again to apply the changes to argv.json.',
  'Configure Runtime Arguments',
  'Not Now',
  'Quit {1}',
];

const FAILURE_TEXTS = [
  "Can't assign requested address",
  'Cancel',
  'Close Remote',
  'Connecting was canceled',
  'Copying VS Code Server to host with scp',
  'Could not establish connection to "{0}"',
  'Could not establish connection to "{0}": {1}',
  'Could not resolve hostname',
  'Downloading VS Code Server',
  'Downloading VS Code Server locally',
  'Hostname contains invalid characters',
  'Initializing VS Code Server',
  'Installing VS Code Server',
  'More Actions...',
  'Network is unreachable',
  'No route to host',
  'Port forwarding is disabled',
  'Remote host key has changed, port forwarding is disabled',
  'Retry',
  'Setting up SSH Host {0}',
  'Setting up SSH tunnel',
  'The connection timed out',
  'The operation timed out',
  'The process tried to write to a nonexistent pipe',
  'Waiting for port forwarding to be ready',
  "{2} knows no download location for the server of {0}. Set {1} to a URL template for this editor's server builds.",
  'The value of {1} is not a usable server download URL template: {3}.',
  'Open Setting',
];

function bundle(file: string): Record<string, string> {
  return JSON.parse(readFileSync(path.join(BUNDLES, file), 'utf8')) as Record<
    string,
    string
  >;
}

describe('the runtime strings of the extension', () => {
  it('the stand-down warning, its button, the out-of-context line, the setup texts and the failure texts are in the default bundle, as written', () => {
    deepStrictEqual(bundle('bundle.l10n.json'), {
      [WARNING]: WARNING,
      [BUTTON]: BUTTON,
      "'{0}' is not possible in the current context.":
        "'{0}' is not possible in the current context.",
      ...Object.fromEntries(
        [...SETUP_TEXTS, ...FAILURE_TEXTS].map(text => [text, text]),
      ),
    });
  });

  it('the warning names no placeholder and carries no process word', () => {
    deepStrictEqual(
      [
        /\{\d+\}/.test(WARNING),
        /reference|Microsoft|ms-vscode|clean-room|reimplement|\bspec\b|\bsession\b|worker|\blab\b|[FRD]-\d/i.test(
          WARNING + BUTTON,
        ),
      ],
      [false, false],
    );
  });

  it('each of the 14 locales has a bundle with the same keys and the English text for now', () => {
    const locales = readdirSync(BUNDLES)
      .filter(file => file !== 'bundle.l10n.json')
      .sort();
    deepStrictEqual(
      {
        count: locales.length,
        tables: locales.map(file => bundle(file)),
      },
      {
        count: 14,
        tables: locales.map(() => bundle('bundle.l10n.json')),
      },
    );
  });
});
