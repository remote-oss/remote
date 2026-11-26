import {deepStrictEqual, throws} from 'node:assert';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ConfigError, readConfig} from '../../src/config.ts';

describe("the agent's shipped defaults", () => {
  let archive = '';
  let code: URL;

  beforeEach(() => {
    archive = mkdtempSync(path.join(tmpdir(), 'agent-config-'));
    mkdirSync(path.join(archive, 'lib'));
    code = pathToFileURL(`${path.join(archive, 'lib')}/`);
  });

  afterEach(() => {
    rmSync(archive, {recursive: true, force: true});
  });

  /** Writes `text` as the archive's `config.json`. */
  function shipped(text: string): void {
    writeFileSync(path.join(archive, 'config.json'), text);
  }

  it('reads the domain and the GitHub app id from the config.json beside the code folder', () => {
    shipped(
      '{"domain":"relay.example","githubClientId":"Iv1.public","other":1}',
    );
    deepStrictEqual(readConfig(code), {
      domain: 'relay.example',
      githubClientId: 'Iv1.public',
    });
  });

  it('fails on the package’s own config.json in the source folder, which ships empty until the release build writes it', () => {
    throws(() => readConfig(new URL('../../src/', import.meta.url)), {
      name: 'Error',
      message: /config\.json has no domain$/,
    });
  });

  it('fails naming the file when it is missing, not JSON, not an object, or short of a key', () => {
    const where = path.join(archive, 'config.json');
    const messages: string[] = [];
    for (const text of [
      undefined,
      'not json',
      'null',
      '{"githubClientId":"Iv1.public"}',
      '{"domain":"relay.example","githubClientId":""}',
      '{"domain":7,"githubClientId":"Iv1.public"}',
    ]) {
      if (text !== undefined) {
        shipped(text);
      }
      try {
        readConfig(code);
        messages.push('read');
      } catch (caught) {
        messages.push(
          caught instanceof ConfigError
            ? caught.message.replace(where, '<file>').replace(/: .*$/, ': …')
            : String(caught),
        );
      }
    }
    deepStrictEqual(messages, [
      "<file> can't be read as JSON: …",
      "<file> can't be read as JSON: …",
      '<file> has no domain',
      '<file> has no domain',
      '<file> has no githubClientId',
      '<file> has no domain',
    ]);
  });
});
