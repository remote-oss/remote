/**
 * @fileoverview The stripping of an identifier inventory to the fixture a fidelity test compares: only the fields the
 * manifest reads, no provenance, no path.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {stripInventory, writeFixture} from './inventory-fixture.ts';

const INVENTORY = {
  inventory: 'the identifiers of the package',
  version: 1,
  date: '2026-10-08',
  specs: 'owner/repo issues',
  conventions: ['a convention'],
  standingDownKey: 'acme.standingDown',
  commands: [
    {id: 'acme.open', title: 'Open', category: 'Acme', spec: 'F-0001'},
    {
      id: 'acme.showLog',
      title: 'Show Log',
      category: 'Acme',
      enablement: null,
      spec: 'F-0002',
    },
  ],
  settings: [
    {
      key: 'acme.timeout',
      type: 'number',
      default: 15,
      scope: 'application',
      description: 'The wait.',
      spec: 'F-0003',
    },
    {
      key: 'acme.note',
      type: 'string',
      description: 'The note.',
      descriptionForm: 'markdownDescription',
      spec: 'F-0004',
    },
  ],
  menus: [
    {
      menu: 'commandPalette',
      command: 'acme.open',
      when: '!acme.standingDown',
      spec: 'F-0005',
    },
  ],
  contextKeys: {
    own: [
      {
        id: 'acme.standingDown',
        setBy: 'extension',
        invented: true,
        spec: 'F-0006',
      },
    ],
    read: [{id: 'remoteName', setBy: 'editor', note: 'a note'}],
  },
  authority: {prefix: 'acme', spec: 'F-0007'},
  remoteHelp: {
    remoteName: ['acme'],
    urls: {documentation: 'https://example.invalid/docs'},
    commands: {'acme.open': 'documentation'},
    spec: 'F-0008',
  },
  internalCommands: [
    {id: 'acme-internal.ack', role: 'served', kind: 'query', spec: 'F-0009'},
  ],
  counts: {commands: 2, settingsListed: 2},
};

describe('inventory-fixture', () => {
  it('keeps the fields the fidelity test reads and nothing else', () => {
    deepStrictEqual(stripInventory(INVENTORY), {
      settings: [
        {
          key: 'acme.timeout',
          type: 'number',
          default: 15,
          scope: 'application',
          description: 'The wait.',
        },
        {
          key: 'acme.note',
          type: 'string',
          description: 'The note.',
          descriptionForm: 'markdownDescription',
        },
      ],
      commands: [
        {id: 'acme.open', title: 'Open', category: 'Acme'},
        {
          id: 'acme.showLog',
          title: 'Show Log',
          category: 'Acme',
          enablement: null,
        },
      ],
      menus: [
        {
          menu: 'commandPalette',
          command: 'acme.open',
          when: '!acme.standingDown',
        },
      ],
      contextKeys: {
        own: [{id: 'acme.standingDown', setBy: 'extension', invented: true}],
        read: [{id: 'remoteName', setBy: 'editor'}],
      },
      activationEvents: [],
      internalCommands: [
        {id: 'acme-internal.ack', role: 'served', kind: 'query'},
      ],
      remoteHelp: {
        remoteName: ['acme'],
        urls: {documentation: 'https://example.invalid/docs'},
        commands: {'acme.open': 'documentation'},
      },
      counts: {commands: 2, settingsListed: 2},
    });
  });

  it('keeps the activation events as strings', () => {
    const fixture = stripInventory({
      ...INVENTORY,
      activationEvents: [
        {event: 'onUri', spec: 'F-0010'},
        {event: 'onResolveRemoteAuthority:acme', spec: 'F-0011'},
      ],
    });
    deepStrictEqual(fixture.activationEvents, [
      'onUri',
      'onResolveRemoteAuthority:acme',
    ]);
  });

  it('keeps the declared and invented flags of the settings', () => {
    const fixture = stripInventory({
      ...INVENTORY,
      settings: [
        {...INVENTORY.settings[0], declared: true},
        {...INVENTORY.settings[1], declared: false, invented: true},
      ],
    });
    deepStrictEqual(fixture.settings, [
      {
        key: 'acme.timeout',
        type: 'number',
        default: 15,
        scope: 'application',
        description: 'The wait.',
        declared: true,
      },
      {
        key: 'acme.note',
        type: 'string',
        description: 'The note.',
        descriptionForm: 'markdownDescription',
        declared: false,
        invented: true,
      },
    ]);
  });

  it('writes the fixture into the package, reading the source from a given path', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'inventory-fixture-'));
    try {
      const sourceFile = path.join(root, 'source-inventory.json');
      writeFileSync(sourceFile, JSON.stringify(INVENTORY));
      const written = writeFixture(root, sourceFile, 'remote-x');
      deepStrictEqual(
        JSON.parse(readFileSync(written, 'utf8')),
        stripInventory(INVENTORY),
      );
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
});
