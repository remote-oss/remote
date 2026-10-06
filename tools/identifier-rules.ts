/**
 * @fileoverview The rules of the CI check `identifiers` over one package's sources (ADR draft "Identifier tables",
 * decision 5; ADR draft "Stand-down gating"): the R-27 ledger and namespaces, the internal ids, the stand-down
 * gating of static contributions, and the references between identifiers.json and the manifest.
 */

import {
  DECLARED_FILE,
  type DeclaredIdentifiers,
  type LedgerKind,
  type MenuEntry,
  type PackageSources,
  type UngatedEntry,
} from './identifier-sources.ts';

/** What a package's rules found: problems fail the check, notes report a part that does not run yet. */
export interface RuleOutcome {
  problems: string[];
  notes: string[];
}

/** The standing-down key as a one-element list once the room has named it, else an empty list. */
function namedStandingDownKey(declared: DeclaredIdentifiers): string[] {
  const standingDownKey = declared.standingDownKey ?? '';
  return standingDownKey === '' ? [] : [standingDownKey];
}

function knownIds(sources: PackageSources): Record<LedgerKind, Set<string>> {
  const {manifest, declared} = sources;
  return {
    commands: new Set(manifest.commands.map(command => command.id)),
    settings: new Set(manifest.settings.map(setting => setting.id)),
    contextKeys: new Set([
      ...declared.contextKeys.map(contextKey => contextKey.id),
      ...namedStandingDownKey(declared),
    ]),
    views: new Set(manifest.views),
    internalCommands: new Set(declared.internal.map(command => command.id)),
  };
}

function ledgerProblems(sources: PackageSources): string[] {
  const {declared} = sources;
  const known = knownIds(sources);
  const problems: string[] = [];
  for (const invented of declared.invented) {
    if (!known[invented.kind].has(invented.id)) {
      problems.push(
        `invented ${invented.kind} id '${invented.id}' (${invented.spec}) is not in the manifest or ${DECLARED_FILE}`,
      );
    }
    const prefixes = declared.namespaces[invented.kind] ?? [];
    if (!prefixes.some(prefix => invented.id.startsWith(prefix))) {
      problems.push(
        `invented ${invented.kind} id '${invented.id}' is outside the reference namespace of its kind (R-27): ${prefixes.length === 0 ? 'none declared' : prefixes.join(', ')}`,
      );
    }
  }
  const [standingDownKey] = namedStandingDownKey(declared);
  if (
    standingDownKey !== undefined &&
    !declared.invented.some(
      invented =>
        invented.kind === 'contextKeys' && invented.id === standingDownKey,
    )
  ) {
    problems.push(
      `standing-down key '${standingDownKey}' is not in the invented ledger as a contextKeys id`,
    );
  }
  return problems;
}

function internalProblems(sources: PackageSources): string[] {
  const {manifest, declared} = sources;
  const contributed = new Set(manifest.commands.map(command => command.id));
  const inMenus = new Set(manifest.menuEntries.map(entry => entry.item));
  const events = new Set(manifest.activationEvents);
  const problems: string[] = [];
  for (const command of declared.internal) {
    if (contributed.has(command.id)) {
      problems.push(
        `internal id '${command.id}' is contributed in contributes.commands`,
      );
    }
    if (inMenus.has(command.id)) {
      problems.push(`internal id '${command.id}' is in a menu`);
    }
    if (command.role === 'served' && !events.has(`onCommand:${command.id}`)) {
      problems.push(
        `served internal id '${command.id}' has no 'onCommand:${command.id}' activation event (F-5902 AC-1, AC-24, AC-33)`,
      );
    }
  }
  return problems;
}

function referenceProblems(sources: PackageSources): string[] {
  const {declared} = sources;
  const known = knownIds(sources);
  const problems: string[] = [];
  for (const command of declared.infoLineCommands) {
    if (!known.commands.has(command)) {
      problems.push(
        `infoLineCommands names '${command}', which is not a contributed command`,
      );
    }
  }
  for (const pair of declared.settingPairs) {
    for (const setting of [pair.current, pair.legacy]) {
      if (!known.settings.has(setting)) {
        problems.push(
          `settingPairs names '${setting}', which is not a contributed setting`,
        );
      }
    }
  }
  return problems;
}

function describeEntry(entry: MenuEntry): string {
  return `${entry.menu} entry '${entry.item}'`;
}

function occurrences(text: string, searched: string): number {
  return text.split(searched).length - 1;
}

function exempts(exemption: UngatedEntry, entry: MenuEntry): boolean {
  return exemption.menu === entry.menu && exemption.item === entry.item;
}

/** Whether a when clause gates its entry: the reference's clause followed by the negated key, or that alone. */
function isGated(when: string, standingDownKey: string): boolean {
  return (
    when === `!${standingDownKey}` ||
    (when.endsWith(` && !${standingDownKey}`) &&
      occurrences(when, standingDownKey) === 1)
  );
}

function gatingProblems(
  sources: PackageSources,
  standingDownKey: string,
): string[] {
  const {manifest, declared} = sources;
  const problems: string[] = [];
  // An entry hidden with `when: "false"` shows nothing, so it cannot duplicate the reference's.
  for (const entry of manifest.menuEntries.filter(
    candidate => candidate.when !== 'false',
  )) {
    const when = entry.when ?? '';
    if (declared.ungated.some(exemption => exempts(exemption, entry))) {
      if (occurrences(when, standingDownKey) > 0) {
        problems.push(
          `${describeEntry(entry)} is ungated but its when clause carries '${standingDownKey}'`,
        );
      }
    } else if (!isGated(when, standingDownKey)) {
      problems.push(
        `${describeEntry(entry)} must end its when clause in ' && !${standingDownKey}', or be '!${standingDownKey}', naming the key once (stand-down gating)`,
      );
    }
  }
  for (const ungated of declared.ungated) {
    if (!manifest.menuEntries.some(entry => exempts(ungated, entry))) {
      problems.push(
        `ungated names ${ungated.menu} entry '${ungated.item}', which the manifest does not contribute`,
      );
    }
  }
  return problems;
}

/** Applies every rule to one package that has identifiers.json. */
export function checkPackageRules(sources: PackageSources): RuleOutcome {
  const [standingDownKey] = namedStandingDownKey(sources.declared);
  const gatingPending = sources.declared.standingDownKey === '';
  return {
    problems: [
      ...ledgerProblems(sources),
      ...internalProblems(sources),
      ...referenceProblems(sources),
      ...(standingDownKey === undefined
        ? []
        : gatingProblems(sources, standingDownKey)),
    ],
    notes: gatingPending
      ? ['stand-down gating pending: standingDownKey is empty']
      : [],
  };
}
