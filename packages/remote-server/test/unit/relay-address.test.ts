import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {RELAY_FILE, readRelayDomain} from '../../src/relay/relay-address.ts';

/** The folder of a row, removed by the suite. */
let folder = '';

beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), 'relay-address-'));
});

afterEach(() => {
  rmSync(folder, {recursive: true, force: true});
});

/** The outcome for an extension folder whose relay file holds `text`, or has no file when `text` is absent. */
function readingFile(text?: string): ReturnType<typeof readRelayDomain> {
  if (text !== undefined) {
    writeFileSync(path.join(folder, RELAY_FILE), text);
  }
  return readRelayDomain(folder);
}

describe('the relay address of Remote - Tunnels (card #3339)', () => {
  it('reads the domain of a relay file, a name under .localhost included', () => {
    deepStrictEqual(
      [
        readingFile('{"domain": "relay.example.org"}'),
        readingFile('{"domain": "run-1.relay.localhost"}'),
        readingFile('{"domain": "localhost"}'),
      ],
      [
        {kind: 'domain', domain: 'relay.example.org'},
        {kind: 'domain', domain: 'run-1.relay.localhost'},
        {kind: 'domain', domain: 'localhost'},
      ],
    );
  });

  it('fails, naming the file, when the extension has none', () => {
    const outcome = readingFile();
    deepStrictEqual(
      [
        outcome.kind,
        outcome.kind === 'failed' && outcome.file,
        outcome.kind === 'failed' &&
          outcome.reason.includes('relay.json cannot be read'),
      ],
      ['failed', path.join(folder, 'relay.json'), true],
    );
  });

  it('fails, naming the file, for text that is no JSON, JSON that is no object, a missing domain, a domain that is no text, and a domain that is no host name', () => {
    const reason = 'relay.json does not hold {"domain": "<host name>"}';
    const failures = [
      'not json',
      '[1]',
      'null',
      '{}',
      '{"domain": 4}',
      '{"domain": ""}',
      '{"domain": "has space.example"}',
      '{"domain": "https://relay.example.org"}',
      '{"domain": "-bad.example"}',
      `{"domain": "${'a'.repeat(64)}.example"}`,
    ].map(text => {
      const outcome = readingFile(text);
      return outcome.kind === 'failed' && outcome.reason;
    });
    deepStrictEqual(
      failures,
      failures.map(() => reason),
    );
  });
});
