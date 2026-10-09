/**
 * @fileoverview inventory-fixture: strips an identifier inventory to the fields a package's fidelity test
 * compares (ADR-0008: generated and stripped, no provenance, no path into the output).
 *
 *     node tools/inventory-fixture.ts <source inventory> <package folder>
 *
 * The output is the package's checked-in fixture, packages/<folder>/test/fixtures/identity-inventory.json.
 */

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {isMainModule, messageOf} from './repository.ts';

/** The fields the fidelity test reads, per kind; everything else of the inventory leaves. */
const SETTING_FIELDS = [
  'key',
  'type',
  'default',
  'scope',
  'enum',
  'enumDescriptions',
  'minimum',
  'maximum',
  'pattern',
  'tags',
  'items',
  'additionalProperties',
  'description',
  'descriptionForm',
  'deprecationMessage',
  'markdownDeprecationMessage',
  'declared',
  'invented',
] as const;

const COMMAND_FIELDS = [
  'id',
  'title',
  'category',
  'enablement',
  'icon',
  'palette',
] as const;

const MENU_FIELDS = ['menu', 'command', 'group', 'when'] as const;

type JsonObject = Record<string, unknown>;

/** The rows of an inventory file. */
interface Inventory {
  settings: JsonObject[];
  commands: JsonObject[];
  menus: JsonObject[];
  contextKeys: {own: JsonObject[]; read: JsonObject[]};
  activationEvents?: Array<{event: string}>;
  internalCommands: JsonObject[];
  remoteHelp: JsonObject;
  counts: JsonObject;
  [name: string]: unknown;
}

/** Keeps only the named fields of a row, in order. */
function strip(item: JsonObject, fields: readonly string[]): JsonObject {
  const kept: JsonObject = {};
  for (const field of fields) {
    if (field in item) {
      kept[field] = item[field];
    }
  }
  return kept;
}

/** The stripped fixture of an inventory, ready to write. */
export function stripInventory(source: unknown): JsonObject {
  const inventory = source as Inventory;
  const activationEvents = (inventory.activationEvents ?? []).map(
    item => item.event,
  );
  // The context-key fields are assigned, not spelled in a literal, because the inventory's field names
  // run under the repo's shortest-name rule.
  const contextKeys: JsonObject = {};
  contextKeys.own = inventory.contextKeys.own.map(item =>
    strip(item, ['id', 'setBy', 'invented']),
  );
  contextKeys.read = inventory.contextKeys.read.map(item =>
    strip(item, ['id', 'setBy']),
  );
  const internalCommands = inventory.internalCommands.map(item =>
    strip(item, ['id', 'role', 'kind', 'servedBy']),
  );
  return {
    settings: inventory.settings.map(item => strip(item, SETTING_FIELDS)),
    commands: inventory.commands.map(item => strip(item, COMMAND_FIELDS)),
    menus: inventory.menus.map(item => strip(item, MENU_FIELDS)),
    contextKeys,
    activationEvents,
    internalCommands,
    remoteHelp: {
      remoteName: inventory.remoteHelp.remoteName,
      ...(inventory.remoteHelp.urls as JsonObject),
    },
    counts: inventory.counts,
  };
}

/** Writes the fixture of `<package>` from the inventory at `<source>` and returns the written file. */
export function writeFixture(
  root: string,
  source: string,
  packageFolder: string,
): string {
  const inventory = JSON.parse(readFileSync(source, 'utf8')) as unknown;
  const fixture = stripInventory(inventory);
  const file = path.join(
    root,
    'packages',
    packageFolder,
    'test',
    'fixtures',
    'identity-inventory.json',
  );
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
  return file;
}

if (isMainModule(import.meta.url)) {
  try {
    const [, , source, packageFolder] = process.argv;
    if (
      source === undefined ||
      packageFolder === undefined ||
      !existsSync(source)
    ) {
      throw new Error(
        'usage: node tools/inventory-fixture.ts <source inventory> <package folder>',
      );
    }
    writeFixture(process.cwd(), source, packageFolder);
    console.log('inventory-fixture: written');
  } catch (error) {
    console.error(`inventory-fixture: ${messageOf(error)}`);
    process.exitCode = 1;
  }
}
