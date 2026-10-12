import {deepStrictEqual} from 'node:assert';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {filled} from '../../src/surfaces/strings.ts';

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
  'Error establishing tunnel ({0}).',
  'Failed to find a free local port: {0}',
  'Hostname contains invalid characters',
  'Initializing VS Code Server',
  'Installing VS Code Server',
  'Max wait time exhausted',
  'More Actions...',
  'Network is unreachable',
  "No free ports in specified range '{0}-{1}'.  Remove or update the 'Preferred Local Port Range' setting and try again.",
  'No route to host',
  'Port forwarding is disabled',
  'Remote host key has changed, port forwarding is disabled',
  'Retry',
  'SSH host name cannot begin with {0}',
  'SSH host name cannot include the character {0}',
  'SSH user name cannot begin with {0}',
  'SSH user name cannot include the character {0}',
  'Setting up SSH Host {0}',
  'Setting up SSH tunnel',
  'The connection timed out',
  'The operation timed out',
  'The process tried to write to a nonexistent pipe',
  'Waiting for port forwarding to be ready',
  "{2} knows no download location for the server of {0}. Set {1} to a URL template for this editor's server builds.",
  'The value of {1} is not a usable server download URL template: {3}.',
  'Open Setting',
  'Got bad result from install script',
];

const CONNECT_TEXTS = [
  'Downloading VS Code Server failed. Please try again later.',
  'Failed to install the VS Code Server',
  'Provided: "{0}"',
  'it does not give an http or https address',
  'the placeholder {0} is not known',
];

const PICKER_TEXTS = ['Select the platform of the remote host "{0}"'];

const MITIGATION_TEXTS = [
  'Reload Window',
  'Open Recent...',
  'Open Documentation',
  'Open SSH Configuration File',
  'Open Settings',
  'Pick an action to help resolve the problem.',
];

const LICENCE_TEXTS = [
  '{0} needs you to accept the license terms of the {1} server before installing it.',
  'Read the terms at {0}.',
  'Accept and Continue',
];

function bundle(file: string): Record<string, string> {
  return JSON.parse(readFileSync(path.join(BUNDLES, file), 'utf8')) as Record<
    string,
    string
  >;
}

describe('the runtime strings of the extension', () => {
  it('the stand-down warning, its button, the out-of-context line, the setup, failure and licence texts are in the default bundle, as written', () => {
    deepStrictEqual(bundle('bundle.l10n.json'), {
      [WARNING]: WARNING,
      [BUTTON]: BUTTON,
      "'{0}' is not possible in the current context.":
        "'{0}' is not possible in the current context.",
      ...Object.fromEntries(
        [
          ...SETUP_TEXTS,
          ...FAILURE_TEXTS,
          ...LICENCE_TEXTS,
          ...PICKER_TEXTS,
          ...CONNECT_TEXTS,
          ...MITIGATION_TEXTS,
          'SSH: {0}',
        ].map(text => [text, text]),
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

describe('filling a template', () => {
  function same(template: string): string {
    return template;
  }

  it('F-3902 rule 8: a value with $& is inserted as written', () => {
    deepStrictEqual(filled(same, 'Host "{0}"', ['box$&']), 'Host "box$&"');
  });

  it('F-3902 rule 8: a value with $1 is inserted as written', () => {
    deepStrictEqual(filled(same, 'Host "{0}"', ['box$1']), 'Host "box$1"');
  });

  it('F-3902 rule 8: a value with $$ is inserted as written', () => {
    deepStrictEqual(filled(same, 'Host "{0}"', ['a$$b']), 'Host "a$$b"');
  });

  it('F-3902 rule 8: a value with a place in it is not filled again', () => {
    deepStrictEqual(filled(same, '{0} and {1}', ['a{1}', 'b']), 'a{1} and b');
  });

  it('F-3902 rule 8: a place without a value stays as written', () => {
    deepStrictEqual(filled(same, '{0} and {1}', ['a']), 'a and {1}');
  });

  it('F-3902 rule 8: a place that occurs twice is filled twice', () => {
    deepStrictEqual(filled(same, '{0}, again {0}', ['z']), 'z, again z');
  });

  it('F-3902 rule 8: the translation is filled, not the English', () => {
    deepStrictEqual(
      filled(() => 'Hôte {0}', 'Host {0}', ['box']),
      'Hôte box',
    );
  });

  it('F-3902 rule 8: a template without places is returned as translated', () => {
    deepStrictEqual(filled(same, 'no places'), 'no places');
  });
});
