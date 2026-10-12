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
  it('passes a package that never stands down, with no gating and no note (F-4901 §6)', () => {
    deepStrictEqual(
      checkPackageRules(
        syntheticSources({
          manifest: {
            menuEntries: [{menu: 'commandPalette', item: 'remote-x.open'}],
          },
        }),
      ),
      {problems: [], notes: []},
    );
  });

  it('notes the gating as pending while the standing-down key is empty', () => {
    deepStrictEqual(
      checkPackageRules(
        syntheticSources({
          manifest: {
            menuEntries: [{menu: 'commandPalette', item: 'remote-x.open'}],
          },
          declared: {standingDownKey: ''},
        }),
      ),
      {
        problems: [],
        notes: ['stand-down gating pending: standingDownKey is empty'],
      },
    );
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

  describe('runtime commands', () => {
    const showDetails = {id: 'opensshremotes.showDetails', purpose: 'p'};

    it('passes an id in the namespace that is not contributed', () => {
      const outcome = checkPackageRules(
        syntheticSources({
          declared: {
            namespaces: {commands: ['opensshremotes.']},
            runtimeCommands: [showDetails],
          },
        }),
      );
      deepStrictEqual(outcome.problems, []);
    });

    it('reports an id that is also contributed', () => {
      const outcome = checkPackageRules(
        syntheticSources({
          manifest: {
            commands: [
              {id: 'opensshremotes.showDetails', title: 'T', palette: true},
            ],
          },
          declared: {
            namespaces: {commands: ['opensshremotes.']},
            runtimeCommands: [showDetails],
          },
        }),
      );
      deepStrictEqual(outcome.problems, [
        "runtime command 'opensshremotes.showDetails' is contributed in contributes.commands",
      ]);
    });

    it('reports an id outside the namespace, naming the prefixes', () => {
      const outcome = checkPackageRules(
        syntheticSources({
          declared: {
            namespaces: {commands: ['opensshremotes.']},
            runtimeCommands: [{id: 'remote.SSH.showDetails', purpose: 'p'}],
          },
        }),
      );
      deepStrictEqual(outcome.problems, [
        "runtime command 'remote.SSH.showDetails' is outside the reference namespace of commands: opensshremotes.",
      ]);
    });

    it('reports an id when no namespace is declared', () => {
      const outcome = checkPackageRules(
        syntheticSources({declared: {runtimeCommands: [showDetails]}}),
      );
      deepStrictEqual(outcome.problems, [
        "runtime command 'opensshremotes.showDetails' is outside the reference namespace of commands: none declared",
      ]);
    });

    it('does not require an activation event', () => {
      const outcome = checkPackageRules(
        syntheticSources({
          manifest: {activationEvents: []},
          declared: {
            namespaces: {commands: ['opensshremotes.']},
            runtimeCommands: [showDetails],
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

    it('passes a bare negated key for an entry the reference shows unconditionally (stand-down gating, decision 1)', () => {
      deepStrictEqual(
        gated([
          {
            menu: 'commandPalette',
            item: 'remote-x.open',
            when: `!${STANDING_DOWN_KEY}`,
          },
        ]),
        [],
      );
    });

    it('passes a clause whose every top-level || alternative ends in the gating clause (stand-down gating, F-3901 5)', () => {
      deepStrictEqual(
        gated([
          {
            menu: 'commandPalette',
            item: 'remote-x.open',
            when: `a && !${STANDING_DOWN_KEY} || b && !${STANDING_DOWN_KEY}`,
          },
        ]),
        [],
      );
    });

    it('passes a clause whose first alternative is the bare negated key (stand-down gating, F-3901 5)', () => {
      deepStrictEqual(
        gated([
          {
            menu: 'commandPalette',
            item: 'remote-x.open',
            when: `!${STANDING_DOWN_KEY} || c && !${STANDING_DOWN_KEY}`,
          },
        ]),
        [],
      );
    });

    it('passes a clause whose || sits inside parentheses (stand-down gating, F-3901 5)', () => {
      deepStrictEqual(
        gated([
          {
            menu: 'commandPalette',
            item: 'remote-x.open',
            when: `(a || b) && !${STANDING_DOWN_KEY}`,
          },
        ]),
        [],
      );
    });

    it('reports the alternative that lacks the key (stand-down gating, F-3901 5)', () => {
      deepStrictEqual(
        gated([
          {
            menu: 'commandPalette',
            item: 'remote-x.open',
            when: `a && !${STANDING_DOWN_KEY} || b`,
          },
        ]),
        [
          `commandPalette entry 'remote-x.open': alternative 'b' must end in ' && !remote-x.standingDown', or be '!remote-x.standingDown', naming the key once (stand-down gating)`,
        ],
      );
    });

    it('reports the first alternative that lacks the key (stand-down gating, F-3901 5)', () => {
      deepStrictEqual(
        gated([
          {
            menu: 'commandPalette',
            item: 'remote-x.open',
            when: `a || b && !${STANDING_DOWN_KEY}`,
          },
        ]),
        [
          `commandPalette entry 'remote-x.open': alternative 'a' must end in ' && !remote-x.standingDown', or be '!remote-x.standingDown', naming the key once (stand-down gating)`,
        ],
      );
    });

    it('reports a key named twice in one alternative (stand-down gating, F-3901 5)', () => {
      deepStrictEqual(
        gated([
          {
            menu: 'commandPalette',
            item: 'remote-x.open',
            when: `a && !${STANDING_DOWN_KEY} && !${STANDING_DOWN_KEY}`,
          },
        ]),
        [
          "commandPalette entry 'remote-x.open' must end its when clause in ' && !remote-x.standingDown', or be '!remote-x.standingDown', naming the key once (stand-down gating)",
        ],
      );
    });

    it('reports a false alternative inside a clause (stand-down gating, F-3901 5)', () => {
      deepStrictEqual(
        gated([
          {
            menu: 'commandPalette',
            item: 'remote-x.open',
            when: `a && !${STANDING_DOWN_KEY} || false`,
          },
        ]),
        [
          `commandPalette entry 'remote-x.open': alternative 'false' must end in ' && !remote-x.standingDown', or be '!remote-x.standingDown', naming the key once (stand-down gating)`,
        ],
      );
    });

    it('exempts an entry hidden with when false, which cannot duplicate', () => {
      deepStrictEqual(
        gated([
          {menu: 'commandPalette', item: 'remote-x.hidden', when: 'false'},
        ]),
        [],
      );
    });

    it('reports an entry without a when clause', () => {
      deepStrictEqual(
        gated([{menu: 'viewsWelcome', item: 'remote-x.targets'}]),
        [
          "viewsWelcome entry 'remote-x.targets' must end its when clause in ' && !remote-x.standingDown', or be '!remote-x.standingDown', naming the key once (stand-down gating)",
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
          "view/title entry 'remote-x.refresh' must end its when clause in ' && !remote-x.standingDown', or be '!remote-x.standingDown', naming the key once (stand-down gating)",
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
          "continueEditSession entry 'remote-x.continue' must end its when clause in ' && !remote-x.standingDown', or be '!remote-x.standingDown', naming the key once (stand-down gating)",
        ],
      );
    });

    it('passes an ungated entry without the key', () => {
      deepStrictEqual(
        gated(
          [{menu: 'view/title', item: 'remote-x.refresh', when: 'isWeb'}],
          [{menu: 'view/title', item: 'remote-x.refresh', reason: 'web only'}],
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
              when: `isWeb && !${STANDING_DOWN_KEY}`,
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
