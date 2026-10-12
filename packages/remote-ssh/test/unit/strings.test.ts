import {deepStrictEqual} from 'node:assert';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';

const BUNDLES = path.join(import.meta.dirname, '..', '..', 'l10n');

const WARNING =
  'Remote - SSH stays inactive in this window because another extension that provides SSH remotes is enabled. Both use the same commands and settings. Disable one of the two and reload the window.';
const BUTTON = 'Show Other Extension';

const SETUP_TEXTS = [
  "{0} needs proposed VS Code APIs that {1} has not enabled for it. Add {2} to 'enable-proposed-api' in argv.json, then restart {1}.",
  "The previous setup attempt did not enable the proposed APIs {0} needs. Check that 'enable-proposed-api' in argv.json lists '{2}', then restart {1}.",
  'Quit and start {1} again to apply the changes to argv.json.',
  'Configure Runtime Arguments',
  'Not Now',
  'Quit {1}',
];

function bundle(file: string): Record<string, string> {
  return JSON.parse(readFileSync(path.join(BUNDLES, file), 'utf8')) as Record<
    string,
    string
  >;
}

describe('the runtime strings of the extension', () => {
  it('the stand-down warning, its button, the out-of-context line and the setup texts are in the default bundle, as written', () => {
    deepStrictEqual(bundle('bundle.l10n.json'), {
      [WARNING]: WARNING,
      [BUTTON]: BUTTON,
      "'{0}' is not possible in the current context.":
        "'{0}' is not possible in the current context.",
      ...Object.fromEntries(SETUP_TEXTS.map(text => [text, text])),
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
