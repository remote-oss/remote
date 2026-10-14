import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  BUTTON_LINKS,
  dialogOf,
  ENGINE_LINKS,
  ENGINE_TEMPLATES,
} from '../../src/surfaces/engine-dialogs.ts';

const BUNDLE = JSON.parse(
  readFileSync(
    path.join(import.meta.dirname, '..', '..', 'l10n', 'bundle.l10n.json'),
    'utf8',
  ),
) as Record<string, string>;

function identity(template: string): string {
  return template;
}

describe('the dialogs of the first check', () => {
  for (const [outcome, written, expected] of [
    [
      'notFound',
      'dk',
      {
        message: 'Docker version 17.12.0 or later required.',
        detail: "Command not found: 'dk'. Check the license for details.",
        buttons: ['Install', 'License'],
      },
    ],
    [
      'notFound',
      'docker',
      {
        message: 'Docker version 17.12.0 or later required.',
        detail: 'Check the license for details.',
        buttons: ['Install', 'License'],
      },
    ],
    [
      'permission',
      'dk',
      {
        message: "Current user does not have permission to run 'docker'.",
        detail: "Try adding the user to the 'docker' group.",
        buttons: ['Documentation'],
      },
    ],
    [
      'tooOld',
      'docker',
      {
        message: 'Docker version 17.12.0 or later required.',
        detail: 'Check the license for details.',
        buttons: ['Install', 'License', 'Ignore'],
      },
    ],
    [
      'engineError',
      'docker',
      {
        message: 'Docker returned an error.',
        detail: 'Make sure the Docker daemon is running.',
        buttons: ['Show Log'],
      },
    ],
  ] as const) {
    it(`F-0201 3.4: ${outcome} for ${written} shows its texts and buttons`, () => {
      const dialog = dialogOf(outcome, written, identity);
      deepStrictEqual(
        {
          message: dialog.message,
          detail: dialog.detail,
          buttons: dialog.buttons.map(button => button.label),
        },
        expected,
      );
    });
  }

  it('F-0201 3.4: every text of the dialogs is a key of the default bundle', () => {
    deepStrictEqual(
      Object.values(ENGINE_TEMPLATES).filter(text => !(text in BUNDLE)),
      [],
    );
  });

  it('R-31: every address is https and names neither aka.ms nor microsoft.com', () => {
    deepStrictEqual(
      Object.values(ENGINE_LINKS).filter(
        address =>
          !address.startsWith('https://') ||
          address.includes('aka.ms') ||
          address.includes('microsoft.com'),
      ),
      [],
    );
  });

  it('R-31: Install, License and Documentation open exactly the three addresses', () => {
    deepStrictEqual(BUTTON_LINKS, {
      openInstall: ENGINE_LINKS.install,
      openLicence: ENGINE_LINKS.licence,
      openPermission: ENGINE_LINKS.permission,
    });
  });
});
