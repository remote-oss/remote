import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  EXPLORER_INBOX,
  INTERFACE_VERSION,
  SSH_ENDPOINTS,
} from '../../src/index.ts';

const DOCUMENT = readFileSync(
  path.join(import.meta.dirname, '..', '..', 'docs', 'companion-interface.md'),
  'utf8',
);

/** The document with its lines joined by single spaces. */
const JOINED = DOCUMENT.split('\n')
  .map(line => line.trim())
  .filter(line => line !== '')
  .join(' ');

describe('the interface document', () => {
  it('F-5902.AC-6: its first line names the version of the library', () => {
    deepStrictEqual(
      DOCUMENT.split('\n')[0],
      `# Companion interface ${String(INTERFACE_VERSION.major)}.${String(INTERFACE_VERSION.minor)}`,
    );
  });

  it('F-5902.AC-6: every id of the endpoints appears between backticks', () => {
    deepStrictEqual(
      [...Object.values(SSH_ENDPOINTS), ...Object.values(EXPLORER_INBOX)]
        .map(endpoint => endpoint.commandId)
        .filter(commandId => !DOCUMENT.includes(`\`${commandId}\``)),
      [],
    );
  });

  it('F-5902.AC-6: the two hand-over commands appear', () => {
    deepStrictEqual(
      ['opensshremotes.openConfigFile', 'opensshremotes.addNewSshHost'].filter(
        commandId => !DOCUMENT.includes(commandId),
      ),
      [],
    );
  });

  it('F-5902.AC-6: the tunnels ids are not in the document', () => {
    deepStrictEqual(DOCUMENT.includes('remote-tunnels.internal.'), false);
  });

  it('F-5902.5.contract: a path without a kind is malformed', () => {
    deepStrictEqual(
      JOINED.includes(
        'A request with a `path` and no `kind` is malformed: the companion opens nothing and rejects the call, shows nothing and writes nothing.',
      ),
      true,
    );
  });

  it('F-5902.5.contract: a kind without a path is ignored', () => {
    deepStrictEqual(
      JOINED.includes(
        'A `kind` without a `path` is ignored, and the host opens with no folder.',
      ),
      true,
    );
  });
});
