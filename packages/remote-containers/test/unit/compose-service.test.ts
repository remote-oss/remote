import {deepStrictEqual, throws} from 'node:assert';
import {
  askService,
  composeServicesOf,
  withServiceKey,
} from '../../src/authoring/compose-service.ts';
import {
  BACK_BUTTON,
  pick,
  pressBack,
  pressEscape,
  scriptedInput,
  type Step,
} from './option-picker.fixture.ts';

const NEVER = new AbortController().signal;

/** The generated compose file of the existing-Compose template, as it is published. */
const GENERATED = [
  "version: '3.8'",
  'services:',
  '  # Update this to the name of the service you want to work with in your docker-compose.yml file',
  '  your-service-name-here:',
  '    volumes:',
  '      - ..:/workspaces:cached',
  '    command: sleep infinity',
  '',
].join('\n');

/** A document whose aliases nest past the parser's default limit: each level names the one before nine times. */
function aliasBomb(): string {
  const levels = ['a0: &a0 [x, x, x, x, x, x, x, x, x]'];
  for (let level = 1; level < 9; level += 1) {
    const before = `*a${String(level - 1)}`;
    levels.push(
      `a${String(level)}: &a${String(level)} [${Array.from({length: 9}, () => before).join(', ')}]`,
    );
  }
  return `${levels.join('\n')}\nservices:\n  app: {}\n`;
}

/** What `askService` answers for `services`, the screen played by `steps`, and the screens it showed. */
async function asked(services: readonly string[], steps: Step[]) {
  const input = scriptedInput(steps);
  const answer = await askService(
    services,
    {
      title: 'Add Dev Container Configuration Files',
      quick: {...input.ports, translate: template => template},
    },
    NEVER,
  );
  return {answer, pickers: input.pickers};
}

describe('the wizard’s Compose service step (card containers-145)', () => {
  describe('composeServicesOf', () => {
    it('F-0413 AC-3: a mapping gives its service names in declaration order, a name that looks like a number included', () => {
      deepStrictEqual(
        composeServicesOf(
          'services:\n  web: {}\n  "8080": {}\n  db:\n    image: x\n',
        ),
        ['web', '8080', 'db'],
      );
    });

    it('F-0413 AC-3: a complex key is named by its YAML text', () => {
      deepStrictEqual(composeServicesOf('services:\n  ? [a, b]\n  : {}\n'), [
        '["a","b"]',
      ]);
    });

    it('F-0413 AC-4: a services list gives its indices', () => {
      deepStrictEqual(composeServicesOf('services:\n  - a\n  - b\n'), [
        '0',
        '1',
      ]);
    });

    it('F-0413 AC-4: an empty, absent or scalar services, and a document that is no mapping, give none', () => {
      deepStrictEqual(
        [
          'services:\n',
          'version: "3"\n',
          'services: web\n',
          '- a\n- b\n',
          '',
        ].map(text => composeServicesOf(text)),
        [[], [], [], [], []],
      );
    });

    it('F-0413 7.E2: a file that isn’t YAML throws its error', () => {
      throws(() => composeServicesOf('services:\n  web: [\n'));
    });

    it('F-0413: a file whose aliases nest past the parser’s default limit throws before it is expanded', () => {
      throws(() => composeServicesOf(aliasBomb()), /alias/i);
    });
  });

  describe('askService', () => {
    it('F-0413 AC-54: one service is used with no step', async () => {
      const {answer, pickers} = await asked(['solo'], []);
      deepStrictEqual(
        [answer, pickers.length],
        [{kind: 'chosen', service: 'solo', shown: false}, 0],
      );
    });

    it('F-0413 AC-4: no service gives the empty name with no step', async () => {
      const {answer, pickers} = await asked([], []);
      deepStrictEqual(
        [answer, pickers.length],
        [{kind: 'chosen', service: '', shown: false}, 0],
      );
    });

    it('F-0413 AC-3, F-0802 AC-32: two or more give S306 in file order, the first focused, single-select, with Back only', async () => {
      const {answer, pickers} = await asked(['web', 'db'], [pick('db')]);
      const [picker] = pickers;
      deepStrictEqual(
        [
          answer,
          picker?.title,
          picker?.placeholder,
          picker?.items.map(entry => [entry.label, entry.description]),
          picker?.activeItems.map(entry => entry.label),
          picker?.canSelectMany,
          picker?.buttons,
        ],
        [
          {kind: 'chosen', service: 'db', shown: true},
          'Add Dev Container Configuration Files',
          'Select a service',
          [
            ['web', undefined],
            ['db', undefined],
          ],
          ['web'],
          false,
          [BACK_BUTTON],
        ],
      );
    });

    it('F-0413 AC-61: Back goes back, and AC-26: Escape cancels', async () => {
      deepStrictEqual(
        [
          (await asked(['web', 'db'], [pressBack])).answer,
          (await asked(['web', 'db'], [pressEscape])).answer,
        ],
        [{kind: 'back'}, {kind: 'cancelled'}],
      );
    });
  });

  describe('withServiceKey', () => {
    it('F-0801 AC-21: the generated service’s key becomes the picked service, the comment above it kept', () => {
      deepStrictEqual(
        withServiceKey(GENERATED, 'api'),
        GENERATED.replace('  your-service-name-here:', '  api:'),
      );
    });

    it('F-0413 7.E10: no service leaves the nameless placeholder, a bare colon under the comment', () => {
      deepStrictEqual(withServiceKey(GENERATED, '').split('\n').slice(2, 4), [
        '  # Update this to the name of the service you want to work with in your docker-compose.yml file',
        '  :',
      ]);
    });

    it('F-0801 AC-21: a name YAML would not read as itself is quoted, a dollar sign kept as it is', () => {
      deepStrictEqual(
        [
          withServiceKey(GENERATED, 'my app').split('\n')[3],
          withServiceKey(GENERATED, 'a$1b').split('\n')[3],
        ],
        ['  "my app":', '  "a$1b":'],
      );
    });

    it('F-0413: a file with no service under services, or no services at all, is left as it is', () => {
      deepStrictEqual(
        [
          withServiceKey('services:\n# none\n', 'api'),
          withServiceKey("version: '3.8'\n", 'api'),
        ],
        ['services:\n# none\n', "version: '3.8'\n"],
      );
    });
  });
});
