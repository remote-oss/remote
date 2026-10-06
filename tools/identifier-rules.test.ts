import {deepStrictEqual} from 'node:assert';
import {syntheticSources} from './identifier-fixtures.ts';
import {checkPackageRules} from './identifier-rules.ts';

const STANDING_DOWN_KEY = 'remote-x.standingDown';

const STANDING_DOWN_LEDGER = {
  id: STANDING_DOWN_KEY,
  kind: 'contextKeys',
  spec: 'F-0001',
  date: '2026-10-06',
} as const;

describe('identifier-rules', () => {
  it('passes a package without identifiers and notes the pending gating', () => {
    deepStrictEqual(checkPackageRules(syntheticSources()), {
      problems: [],
      notes: ['stand-down gating pending: standingDownKey is empty'],
    });
  });

  describe('ledger (R-27)', () => {
    it('passes an invented id that exists inside its namespace', () => {
      const outcome = checkPackageRules(
        syntheticSources({
          manifest: {settings: [{id: 'remote.X.newSetting', scope: 'window'}]},
          declared: {
            namespaces: {settings: ['remote.X.']},
            invented: [
              {
                id: 'remote.X.newSetting',
                kind: 'settings',
                spec: 'F-0001',
                date: '2026-10-06',
              },
            ],
          },
        }),
      );
      deepStrictEqual(outcome.problems, []);
    });

    it('reports a ledger id missing from the manifest', () => {
      const outcome = checkPackageRules(
        syntheticSources({
          declared: {
            namespaces: {commands: ['remote-x.']},
            invented: [
              {
                id: 'remote-x.gone',
                kind: 'commands',
                spec: 'F-0001',
                date: '2026-10-06',
              },
            ],
          },
        }),
      );
      deepStrictEqual(outcome.problems, [
        "invented commands id 'remote-x.gone' (F-0001) is not in the manifest or identifiers.json",
      ]);
    });

    it('reports an invented id outside its kind namespace', () => {
      const outcome = checkPackageRules(
        syntheticSources({
          manifest: {views: ['remote-oss.targets']},
          declared: {
            namespaces: {views: ['remote-x.', 'remote-y.']},
            invented: [
              {
                id: 'remote-oss.targets',
                kind: 'views',
                spec: 'F-0001',
                date: '2026-10-06',
              },
            ],
          },
        }),
      );
      deepStrictEqual(outcome.problems, [
        "invented views id 'remote-oss.targets' is outside the reference namespace of its kind (R-27): remote-x., remote-y.",
      ]);
    });

    it('reports an invented id whose kind has no namespace', () => {
      const outcome = checkPackageRules(
        syntheticSources({
          declared: {
            internal: [
              {id: 'remote-internal.ping', role: 'called', kind: 'push'},
            ],
            invented: [
              {
                id: 'remote-internal.ping',
                kind: 'internalCommands',
                spec: 'F-5902',
                date: '2026-10-06',
              },
            ],
          },
        }),
      );
      deepStrictEqual(outcome.problems, [
        "invented internalCommands id 'remote-internal.ping' is outside the reference namespace of its kind (R-27): none declared",
      ]);
    });

    it('reports a standing-down key missing from the ledger', () => {
      const outcome = checkPackageRules(
        syntheticSources({declared: {standingDownKey: STANDING_DOWN_KEY}}),
      );
      deepStrictEqual(outcome.problems, [
        "standing-down key 'remote-x.standingDown' is not in the invented ledger as a contextKeys id",
      ]);
    });

    it('accepts a declared context key as present', () => {
      const outcome = checkPackageRules(
        syntheticSources({
          declared: {
            namespaces: {contextKeys: ['remote-x.']},
            contextKeys: [{id: 'remote-x.connected', setter: 'extension'}],
            invented: [
              {
                id: 'remote-x.connected',
                kind: 'contextKeys',
                spec: 'F-0001',
                date: '2026-10-06',
              },
            ],
          },
        }),
      );
      deepStrictEqual(outcome.problems, []);
    });
  });

  describe('internal ids (F-5902 §5)', () => {
    it('passes a served id with its activation event', () => {
      const outcome = checkPackageRules(
        syntheticSources({
          manifest: {activationEvents: ['onCommand:remote-internal.get']},
          declared: {
            internal: [
              {id: 'remote-internal.get', role: 'served', kind: 'query'},
            ],
          },
        }),
      );
      deepStrictEqual(outcome.problems, []);
    });

    it('reports a served id without its onCommand event (F-5902 AC-1, AC-24, AC-33)', () => {
      const outcome = checkPackageRules(
        syntheticSources({
          declared: {
            internal: [
              {id: 'remote-internal.get', role: 'served', kind: 'query'},
            ],
          },
        }),
      );
      deepStrictEqual(outcome.problems, [
        "served internal id 'remote-internal.get' has no 'onCommand:remote-internal.get' activation event (F-5902 AC-1, AC-24, AC-33)",
      ]);
    });

    it('reports an internal id that is contributed and in a menu', () => {
      const outcome = checkPackageRules(
        syntheticSources({
          manifest: {
            commands: [
              {id: 'remote-internal.set', title: 'Set', palette: true},
            ],
            menuEntries: [
              {menu: 'commandPalette', item: 'remote-internal.set'},
            ],
          },
          declared: {
            internal: [
              {id: 'remote-internal.set', role: 'called', kind: 'change'},
            ],
          },
        }),
      );
      deepStrictEqual(outcome.problems, [
        "internal id 'remote-internal.set' is contributed in contributes.commands",
        "internal id 'remote-internal.set' is in a menu",
      ]);
    });
  });

  describe('references into the manifest', () => {
    it('reports an info-line command that is not contributed', () => {
      const outcome = checkPackageRules(
        syntheticSources({declared: {infoLineCommands: ['remote-x.gone']}}),
      );
      deepStrictEqual(outcome.problems, [
        "infoLineCommands names 'remote-x.gone', which is not a contributed command",
      ]);
    });

    it('reports a setting pair whose keys are not contributed', () => {
      const outcome = checkPackageRules(
        syntheticSources({
          manifest: {settings: [{id: 'dev.x.path', scope: 'window'}]},
          declared: {
            settingPairs: [
              {
                current: 'dev.x.path',
                legacy: 'remote.x.path',
                winner: 'current',
              },
            ],
          },
        }),
      );
      deepStrictEqual(outcome.problems, [
        "settingPairs names 'remote.x.path', which is not a contributed setting",
      ]);
    });
  });

  describe('stand-down gating', () => {
    function gated(
      menuEntries: Array<{menu: string; item: string; when?: string}>,
      ungated: Array<{menu: string; item: string; reason: string}> = [],
    ): string[] {
      return checkPackageRules(
        syntheticSources({
          manifest: {menuEntries},
          declared: {
            standingDownKey: STANDING_DOWN_KEY,
            namespaces: {contextKeys: ['remote-x.']},
            invented: [STANDING_DOWN_LEDGER],
            ungated,
          },
        }),
      ).problems;
    }

    it('passes entries that end in the gating clause, with no note', () => {
      deepStrictEqual(
        checkPackageRules(
          syntheticSources({
            manifest: {
              menuEntries: [
                {
                  menu: 'commandPalette',
                  item: 'remote-x.open',
                  when: `isWindows && !${STANDING_DOWN_KEY}`,
                },
              ],
            },
            declared: {
              standingDownKey: STANDING_DOWN_KEY,
              namespaces: {contextKeys: ['remote-x.']},
              invented: [STANDING_DOWN_LEDGER],
            },
          }),
        ),
        {problems: [], notes: []},
      );
    });

    it('reports an entry without a when clause', () => {
      deepStrictEqual(
        gated([{menu: 'viewsWelcome', item: 'remote-x.targets'}]),
        [
          "viewsWelcome entry 'remote-x.targets' must end its when clause in ' && !remote-x.standingDown' and name the key once (stand-down gating)",
        ],
      );
    });

    it('reports an entry whose clause does not end in the gating clause', () => {
      deepStrictEqual(
        gated([
          {
            menu: 'view/title',
            item: 'remote-x.refresh',
            when: `!${STANDING_DOWN_KEY} && view == remote-x.targets`,
          },
        ]),
        [
          "view/title entry 'remote-x.refresh' must end its when clause in ' && !remote-x.standingDown' and name the key once (stand-down gating)",
        ],
      );
    });

    it('reports an entry that names the key twice', () => {
      deepStrictEqual(
        gated([
          {
            menu: 'continueEditSession',
            item: 'remote-x.continue',
            when: `!${STANDING_DOWN_KEY} && !${STANDING_DOWN_KEY}`,
          },
        ]),
        [
          "continueEditSession entry 'remote-x.continue' must end its when clause in ' && !remote-x.standingDown' and name the key once (stand-down gating)",
        ],
      );
    });

    it('passes an ungated entry without the key', () => {
      deepStrictEqual(
        gated(
          [{menu: 'commandPalette', item: 'remote-x.hidden', when: 'false'}],
          [{menu: 'commandPalette', item: 'remote-x.hidden', reason: 'hidden'}],
        ),
        [],
      );
    });

    it('reports an ungated entry that carries the key', () => {
      deepStrictEqual(
        gated(
          [
            {
              menu: 'commandPalette',
              item: 'remote-x.hidden',
              when: `false && !${STANDING_DOWN_KEY}`,
            },
          ],
          [{menu: 'commandPalette', item: 'remote-x.hidden', reason: 'hidden'}],
        ),
        [
          "commandPalette entry 'remote-x.hidden' is ungated but its when clause carries 'remote-x.standingDown'",
        ],
      );
    });

    it('reports an exemption for an entry the manifest does not contribute', () => {
      deepStrictEqual(
        gated(
          [],
          [{menu: 'commandPalette', item: 'remote-x.gone', reason: 'r'}],
        ),
        [
          "ungated names commandPalette entry 'remote-x.gone', which the manifest does not contribute",
        ],
      );
    });
  });
});
