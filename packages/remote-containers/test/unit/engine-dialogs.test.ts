import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  BUTTON_LINKS,
  dashHostDialogOf,
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

  it('R-31: Install, License and the two Documentation buttons open exactly the four addresses', () => {
    deepStrictEqual(BUTTON_LINKS, {
      openInstall: ENGINE_LINKS.install,
      openLicence: ENGINE_LINKS.licence,
      openPermission: ENGINE_LINKS.permission,
      openCompose: ENGINE_LINKS.compose,
    });
  });
});

describe('the dialogs of an ssh Docker host (card containers-173)', () => {
  it('F-0205 AC-7, AC-44, AC-12a: each has its message, its detail and Show Log', () => {
    deepStrictEqual(
      [
        dialogOf('sshDenied', 'docker', identity),
        dialogOf('sshTooMany', 'docker', identity),
        dashHostDialogOf('-badhost', identity),
      ].map(dialog => [
        dialog.message,
        dialog.detail,
        dialog.buttons.map(button => [button.label, button.action]),
      ]),
      [
        [
          "Cannot connect to Docker daemon using 'ssh'.",
          'Make sure public/private keys are set up for connecting without keyboard interaction.',
          [['Show Log', 'showLog']],
        ],
        [
          "Cannot connect to Docker daemon using 'ssh'. Make sure public/private keys are set up for connecting without keyboard interaction.",
          '',
          [['Show Log', 'showLog']],
        ],
        [
          'Hostname must not start with a dash: -badhost',
          '',
          [['Show Log', 'showLog']],
        ],
      ],
    );
  });
});

describe('the dialogs a missing Docker program shows (card coverage-114)', () => {
  it('F-0207 AC-13 (c114-notfound-dialog): the notFound dialog is S146 with the licence detail, Install first beside License', () => {
    const dialog = dialogOf('notFound', 'docker', identity);
    deepStrictEqual(
      [
        dialog.message,
        dialog.detail,
        dialog.buttons.map(button => [button.label, button.action]),
      ],
      [
        'Docker version 17.12.0 or later required.',
        'Check the license for details.',
        [
          ['Install', 'openInstall'],
          ['License', 'openLicence'],
        ],
      ],
    );
  });

  it('F-0207 AC-14 (c114-licence-page): the License button of the notFound dialog opens the subscription service agreement page, an own address under R-31', () => {
    const notFound = dialogOf('notFound', 'docker', identity);
    deepStrictEqual(
      notFound.buttons.map(button =>
        button.action === 'openLicence'
          ? BUTTON_LINKS.openLicence
          : button.action,
      ),
      [
        'openInstall',
        'https://www.docker.com/legal/docker-subscription-service-agreement/',
      ],
    );
  });

  it('F-0207 AC-24 (c114-no-app-launch): no button action of the engine dialogs launches an application, and the notFound dialog opens its two pages only', () => {
    const notFound = dialogOf('notFound', 'docker', identity);
    deepStrictEqual(
      [
        notFound.buttons.map(button => button.action),
        Object.keys(BUTTON_LINKS).sort(),
      ],
      [
        ['openInstall', 'openLicence'],
        ['openCompose', 'openInstall', 'openLicence', 'openPermission'],
      ],
    );
  });

  it('F-1301 AC-6 (c114-notfound-no-wsl-wording): a missing Docker program shows no WSL wording in its dialog', () => {
    const notFound = dialogOf('notFound', 'docker', identity);
    deepStrictEqual(
      [
        notFound.message,
        notFound.detail,
        ...notFound.buttons.map(button => button.label),
      ].filter(text => /\bWSL\b/i.test(text)),
      [],
    );
  });
});
