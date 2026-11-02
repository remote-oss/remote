/**
 * @fileoverview The POSIX bootstrap script's rewrite of the unpacked server's identity (F-3902 rule 9), run for real
 * over stand-in tools: the folder install, the tree install and the stepwise unpack.
 */

import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  fakeHost,
  type FakeHost,
  installFolder,
  parametersFor,
  runScript,
  single,
} from './fake-host.ts';
import {serverFactsOf, statusOf} from './bootstrap-script.fixture.ts';

/** The client's commit in the baseline parameters. */
const COMMIT = 'abc1230000000000000000000000000000000000';

/** The commit of an earlier release's server. */
const EARLIER = '1234567890abcdef1234567890abcdef12345678';

/** The fixed time of the product file in an archive, which an untouched file keeps. */
const OLD_TIME = new Date('2001-02-03T04:05:06Z');

/** An archive of a server whose `product.json` holds `product`, or none when it is absent. */
function archiveOf(host: FakeHost, product: string | undefined): string {
  const source = path.join(host.home, 'identity-source', 'server-1.0');
  rmSync(path.dirname(source), {recursive: true, force: true});
  mkdirSync(path.join(source, 'bin'), {recursive: true});
  writeFileSync(path.join(source, 'bin', 'launcher'), '#!/bin/sh\n');
  chmodSync(path.join(source, 'bin', 'launcher'), 0o755);
  if (product !== undefined) {
    writeFileSync(path.join(source, 'product.json'), product);
    utimesSync(path.join(source, 'product.json'), OLD_TIME, OLD_TIME);
  }
  const archive = path.join(host.home, 'identity.tar.gz');
  spawnSync('tar', ['-czf', archive, '-C', path.dirname(source), 'server-1.0']);
  return archive;
}

/** A pretty-printed product file of the commit, with members around it, and the same on one line. */
function prettyProduct(commit: string): string {
  return `{\n  "nameShort": "Server",\n  "commit": "${commit}",\n  "date": "2026-01-01T00:00:00.000Z"\n}\n`;
}

function minifiedProduct(commit: string): string {
  return `{"nameShort":"Server","commit":"${commit}","date":"2026-01-01T00:00:00.000Z"}`;
}

describe('the rewrite of the unpacked server’s identity (card server-28)', () => {
  let host: FakeHost;

  beforeEach(() => {
    host = fakeHost();
  });

  /** The baseline parameters with the archive of `product` on the host. */
  function parametersWith(product: string | undefined) {
    const parameters = parametersFor();
    parameters.archivePath = archiveOf(host, product);
    return parameters;
  }

  for (const [name, make] of [
    ['pretty-printed', prettyProduct],
    ['minified', minifiedProduct],
  ] as const) {
    it(`F-3902 AC-16: a ${name} product.json whose commit differs comes out with only the 40 characters of the commit changed, and the block has both facts`, () => {
      const parameters = parametersWith(make(EARLIER));
      const facts = serverFactsOf(host, single('install'), parameters);
      deepStrictEqual(
        [
          readFileSync(path.join(installFolder(host), 'product.json'), 'utf8'),
          facts.identityFrom,
          facts.identityTo,
          readdirSync(installFolder(host)).filter(each =>
            each.includes('.identity.'),
          ),
        ],
        [make(COMMIT), EARLIER, COMMIT, []],
      );
    });
  }

  it('F-3902 AC-16: equal commits leave the file untouched, with the same bytes and time and neither fact', () => {
    const parameters = parametersWith(prettyProduct(COMMIT));
    const facts = serverFactsOf(host, single('install'), parameters);
    const product = path.join(installFolder(host), 'product.json');
    deepStrictEqual(
      [
        readFileSync(product, 'utf8'),
        statSync(product).mtime.getTime(),
        facts.identityFrom,
        facts.identityTo,
      ],
      [prettyProduct(COMMIT), OLD_TIME.getTime(), undefined, undefined],
    );
  });

  for (const [name, product] of [
    ['has no commit member', '{"nameShort":"Server"}\n'],
    [
      'holds a commit that is not 40 lowercase hex digits',
      '{"commit":"abc123"}\n',
    ],
    ['is absent', undefined],
  ] as const) {
    it(`F-3902 AC-16: a server whose product.json ${name} is UnpackFailed`, () => {
      deepStrictEqual(
        statusOf(host, single('install'), parametersWith(product)),
        'UnpackFailed',
      );
    });
  }

  it('F-3902 AC-16: the tree install rewrites the tree’s product.json', () => {
    const parameters = parametersWith(prettyProduct(EARLIER));
    parameters.installTree = path.join(host.home, 'volume', 'bin', COMMIT);
    const facts = serverFactsOf(host, single('install'), parameters);
    deepStrictEqual(
      [
        readFileSync(path.join(parameters.installTree, 'product.json'), 'utf8'),
        facts.identityFrom,
      ],
      [prettyProduct(COMMIT), EARLIER],
    );
  });

  it('F-3902 AC-16: the stepwise unpack rewrites the staging folder’s product.json', () => {
    const parameters = parametersWith(prettyProduct(EARLIER));
    const archive = readFileSync(parameters.archivePath);
    runScript(host, {installMode: 'stepwise', step: 'prepare'}, parameters);
    const facts = serverFactsOf(
      host,
      {installMode: 'stepwise', step: 'unpack'},
      parameters,
      {input: archive},
    );
    deepStrictEqual(
      [
        readFileSync(
          path.join(
            host.home,
            '.server-data',
            'bin',
            `${COMMIT}-${String(parameters.epochMilliseconds)}`,
            'product.json',
          ),
          'utf8',
        ),
        facts.identityFrom,
        facts.identityTo,
      ],
      [prettyProduct(COMMIT), EARLIER, COMMIT],
    );
  });
});
