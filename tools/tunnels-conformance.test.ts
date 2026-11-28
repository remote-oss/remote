import {deepStrictEqual, rejects} from 'node:assert';
import {X509Certificate} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:https';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  CONFORMANCE_LAUNCH,
  type ConformanceRow,
  runRows,
  verdictLinesOf,
} from '../tests/tunnels-conformance/conformance.ts';
import {
  ACCOUNTS,
  answerOf,
  identityServer,
  startingAllowlist,
  startingTable,
  TOKENS,
} from '../tests/tunnels-conformance/identities.ts';
import {checkListing, relayGet} from '../tests/tunnels-conformance/rows.ts';
import {
  buildRelayImage,
  filesOf,
  identityArgumentsOf,
  isReady,
  makeRunCertificates,
  namesOf,
  relayArgumentsOf,
  relayEnvironmentOf,
  type Stack,
  startStack,
  stopStack,
} from '../tests/tunnels-conformance/stack.ts';
import {type CommandRunner, runCommand} from './command-runner.ts';
import type {KnownRed} from './known-reds.ts';

/** A command a fake runner was given: the program and its first two words. */
type Given = [string, string, string | undefined];

/** A runner that answers every command with status 0 and the output `answers` gives for its program and first word. */
function fakeRunner(answers: Readonly<Record<string, string>>): {
  given: Given[];
  command: CommandRunner;
} {
  const given: Given[] = [];
  return {
    given,
    command: (program, programArguments) => {
      given.push([program, programArguments[0] ?? '', programArguments[1]]);
      return {
        status: 0,
        stdout: answers[`${program} ${programArguments[0] ?? ''}`] ?? '',
        stderr: '',
      };
    },
  };
}

/** A new run folder, removed after the row. */
function runFolder(): string {
  return mkdtempSync(path.join(tmpdir(), 'tunnels-row-'));
}

describe('the stub identity service of the tunnels run (card #3076)', () => {
  it('answers a listed bearer token with its account', () => {
    deepStrictEqual(
      answerOf(startingTable(), 'GET', '/user', `Bearer ${TOKENS.listed}`),
      {status: 200, body: ACCOUNTS.listed},
    );
  });

  it('answers 401 to a token it does not list, to no header and to another scheme', () => {
    deepStrictEqual(
      [`Bearer ${TOKENS.refused}`, undefined, `token ${TOKENS.listed}`].map(
        header => answerOf(startingTable(), 'GET', '/user', header).status,
      ),
      [401, 401, 401],
    );
  });

  it('answers 404 to another path and to another method', () => {
    deepStrictEqual(
      [
        answerOf(startingTable(), 'GET', '/users', `Bearer ${TOKENS.listed}`),
        answerOf(startingTable(), 'POST', '/user', `Bearer ${TOKENS.listed}`),
      ].map(answer => answer.status),
      [404, 404],
    );
  });

  it('starts with every token but the refused one, the personal one naming the listed account', () => {
    const table = startingTable();
    deepStrictEqual(
      {
        refused: TOKENS.refused in table,
        personal: table[TOKENS.listedPersonal],
      },
      {refused: false, personal: ACCOUNTS.listed},
    );
  });

  it('starts the allowlist with the two listed accounts’ ids, one per line', () => {
    deepStrictEqual(startingAllowlist(), '9100001\n9100002\n');
  });

  it('reads its table at each request, so a changed login answers at once', async () => {
    const folder = runFolder();
    const tableFile = path.join(folder, 'identities.json');
    writeFileSync(tableFile, JSON.stringify(startingTable()));
    const server = identityServer(tableFile).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const address = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/user`;
    async function login(): Promise<unknown> {
      const response = await fetch(address, {
        headers: {authorization: `Bearer ${TOKENS.listed}`},
      });
      return ((await response.json()) as {login: string}).login;
    }
    const before = await login();
    writeFileSync(
      tableFile,
      JSON.stringify({
        [TOKENS.listed]: {id: ACCOUNTS.listed.id, login: 'renamed'},
      }),
    );
    const after = await login();
    server.close();
    rmSync(folder, {recursive: true, force: true});
    deepStrictEqual([before, after], [ACCOUNTS.listed.login, 'renamed']);
  });
});

describe('the tunnels run’s stack (card #3076)', () => {
  it('names its network and both containers after the run folder, in lower case', () => {
    deepStrictEqual(namesOf('/tmp/Tunnels-Run-Ab1'), {
      network: 'tunnels-tunnels-run-ab1',
      relay: 'tunnels-tunnels-run-ab1-relay',
      identity: 'tunnels-tunnels-run-ab1-identity',
    });
  });

  it('gives the relay its settings: the run’s domain, cluster, low limits and the run files as mounted', () => {
    deepStrictEqual(relayEnvironmentOf('run.tunnels.test', '/tmp/run'), [
      '-e',
      'RELAY_PORT=443',
      '-e',
      'RELAY_DOMAIN=run.tunnels.test',
      '-e',
      'RELAY_CLUSTER=usw2',
      '-e',
      'TLS_CERT=/run-files/relay.pem',
      '-e',
      'TLS_KEY=/run-files/relay-key.pem',
      '-e',
      'RELAY_STORE=/run-files/store.sqlite',
      '-e',
      'RELAY_GITHUB_API=http://identity:8080',
      '-e',
      'RELAY_ALLOWLIST=/run-files/allowlist',
      '-e',
      'RELAY_TOKEN_KEY=/run-files/token-key',
      '-e',
      'RELAY_LIMIT_TUNNELS=2',
      '-e',
      'RELAY_LIMIT_PORTS=2',
      '-e',
      'RELAY_LIMIT_CLIENTS=2',
    ]);
  });

  it('starts the relay under its control-plane name and its domain, published on the runner only when asked', () => {
    const names = namesOf('/tmp/run');
    const published = relayArgumentsOf(
      names,
      'run.test',
      '/tmp/run',
      '1001:1001',
      true,
    );
    const unpublished = relayArgumentsOf(
      names,
      'run.test',
      '/tmp/run',
      '1001:1001',
      false,
    );
    deepStrictEqual(
      {
        start: published.slice(0, 14),
        publish: published.slice(14, 16),
        unpublished: unpublished.includes('--publish'),
        image: published.at(-1),
      },
      {
        start: [
          'run',
          '--detach',
          '--name',
          'tunnels-run-relay',
          '--network',
          'tunnels-run',
          '--user',
          '1001:1001',
          '--volume',
          '/tmp/run:/run-files',
          '--network-alias',
          'cp.run.test',
          '--network-alias',
          'run.test',
        ],
        publish: ['--publish', '127.0.0.1:443:443'],
        unpublished: false,
        image: 'remote-oss-tunnel-relay:run',
      },
    );
  });

  it('starts the identity service on the relay’s image, from the suite folder mounted read-only', () => {
    const started = identityArgumentsOf(
      namesOf('/tmp/run'),
      '/tmp/run',
      '1001:1001',
    );
    deepStrictEqual(
      {
        name: started.slice(2, 4),
        alias: started.slice(10, 12),
        suite: started[13]?.endsWith('/tests/tunnels-conformance:/suite:ro'),
        settings: started.slice(14, 18),
        entry: started.slice(18),
      },
      {
        name: ['--name', 'tunnels-run-identity'],
        alias: ['--network-alias', 'identity'],
        suite: true,
        settings: [
          '-e',
          'STUB_IDENTITIES=/run-files/identities.json',
          '-e',
          'STUB_PORT=8080',
        ],
        entry: [
          '--entrypoint',
          'node',
          'remote-oss-tunnel-relay:run',
          '/suite/stub-identity.ts',
        ],
      },
    );
  });

  it('makes an authority of the run’s own and a relay certificate for every name of the domain, signed by it', () => {
    const folder = runFolder();
    makeRunCertificates(runCommand, folder, 'run.tunnels.test');
    const files = filesOf(folder);
    const authority = new X509Certificate(readFileSync(files.caFile));
    const relay = new X509Certificate(readFileSync(files.certificateFile));
    rmSync(folder, {recursive: true, force: true});
    deepStrictEqual(
      {
        authority: authority.ca,
        relay: relay.ca,
        issued: relay.checkIssued(authority),
        signed: relay.verify(authority.publicKey),
        names: relay.subjectAltName,
      },
      {
        authority: true,
        relay: false,
        issued: true,
        signed: true,
        names:
          'DNS:cp.run.tunnels.test, DNS:run.tunnels.test, DNS:*.run.tunnels.test',
      },
    );
  });

  it('builds the image from the relay package deployed from the lockfile, under the suite’s Dockerfile', () => {
    const {given, command} = fakeRunner({});
    buildRelayImage(command, '/tmp/run/relay-image');
    deepStrictEqual(given, [
      ['pnpm', '--dir', path.join(import.meta.dirname, '..')],
      ['docker', 'build', '--quiet'],
    ]);
  });

  it('starts the stack in order and gives the relay’s address on the run’s network', async () => {
    const folder = runFolder();
    const {given, command} = fakeRunner({
      'docker logs': 'the relay serves cp.run.test on port 443\n',
      'docker inspect': '172.18.0.9\n',
    });
    const stack = await startStack(command, {
      domain: 'run.test',
      folder,
      published: false,
      readyMilliseconds: 0,
    });
    rmSync(folder, {recursive: true, force: true});
    deepStrictEqual(
      {
        steps: given.map(([program, first]) => `${program} ${first}`),
        address: [stack.relayAddress, stack.relayPort],
      },
      {
        steps: [
          'pnpm --dir',
          'docker build',
          'openssl req',
          'openssl req',
          'openssl x509',
          'docker network',
          'docker run',
          'docker run',
          'docker logs',
          'docker inspect',
        ],
        address: ['172.18.0.9', 443],
      },
    );
  });

  it('fails with the relay’s output when it prints no ready line in time', async () => {
    const folder = runFolder();
    const {command} = fakeRunner({'docker logs': 'the relay cannot start\n'});
    await rejects(
      startStack(command, {
        domain: 'run.test',
        folder,
        published: false,
        readyMilliseconds: 0,
      }),
      /the relay printed no ready line in 0 ms: the relay cannot start/,
    );
    rmSync(folder, {recursive: true, force: true});
  });

  it('removes both containers and the network, whichever of them exist', () => {
    const {given, command} = fakeRunner({});
    stopStack(command, namesOf('/tmp/run'));
    deepStrictEqual(given, [
      ['docker', 'rm', '--force'],
      ['docker', 'network', 'rm'],
    ]);
  });

  it('reads the relay’s ready line in its output, and nothing else as one', () => {
    deepStrictEqual(
      [
        isReady('x\nthe relay serves cp.run.test on port 443\n'),
        isReady('the relay failed: x\n'),
      ],
      [true, false],
    );
  });
});

/** A stack whose relay is a local server on `port`, with the run's files in `folder`. */
function localStack(folder: string, port: number): Stack {
  return {
    domain: 'run.tunnels.test',
    names: namesOf(folder),
    files: filesOf(folder),
    relayAddress: '127.0.0.1',
    relayPort: port,
  };
}

describe('the tunnels conformance run’s rows (card #3076)', () => {
  const listed: KnownRed = {
    launch: CONFORMANCE_LAUNCH,
    file: 'tunnels-conformance/rows.ts',
    title: 'red',
    card: 3076,
    owner: 'proteus',
    evidence: 1,
    added: '2026-11-28',
  };

  function conformanceRow(title: string, failure?: string): ConformanceRow {
    return {
      file: 'tunnels-conformance/rows.ts',
      title,
      check: () =>
        failure === undefined
          ? Promise.resolve()
          : Promise.reject(new Error(failure)),
    };
  }

  it('runs each row once, in order, with a line for each and the outcome of all', async () => {
    const lines: string[] = [];
    const outcome = await runRows(
      [
        conformanceRow('green'),
        conformanceRow('red', 'GET /tunnels answered 403'),
      ],
      localStack('/tmp/run', 443),
      line => lines.push(line),
    );
    deepStrictEqual(
      {
        lines,
        passes: outcome.passes.length,
        failures: outcome.failures.map(each => each.message),
      },
      {
        lines: [
          'tunnels-conformance: ok green',
          'tunnels-conformance: FAIL red: GET /tunnels answered 403',
        ],
        passes: 1,
        failures: ['GET /tunnels answered 403'],
      },
    );
  });

  it('excuses a red the list names on a pull request only', async () => {
    const outcome = await runRows(
      [conformanceRow('red', 'x')],
      localStack('/tmp/run', 443),
      () => undefined,
    );
    deepStrictEqual(
      [
        verdictLinesOf(outcome, [listed], true),
        verdictLinesOf(outcome, [listed], false).passes,
      ],
      [
        {passes: true, lines: ['tunnels-conformance: excused on #3076: red']},
        false,
      ],
    );
  });

  it('says a listed row is green now, so its entry can go', async () => {
    const outcome = await runRows(
      [conformanceRow('red')],
      localStack('/tmp/run', 443),
      () => undefined,
    );
    deepStrictEqual(verdictLinesOf(outcome, [listed], true).lines, [
      'tunnels-conformance: now green, remove its entry from tools/known-reds.json (#3076): red',
    ]);
  });

  it('takes a 200 listing in the run’s cluster, and refuses another status or another cluster', () => {
    function verdict(status: number, body: string): string {
      try {
        checkListing({status, body});
        return 'listed';
      } catch (failure) {
        return (failure as Error).message;
      }
    }
    deepStrictEqual(
      [
        verdict(200, '{"value":[{"clusterId":"usw2","value":[]}]}'),
        verdict(403, '{"title":"Forbidden"}'),
        verdict(200, '{"value":[{"clusterId":"euw","value":[]}]}'),
      ],
      [
        'listed',
        'GET /tunnels answered 403: {"title":"Forbidden"}',
        'GET /tunnels answered 200: {"value":[{"clusterId":"euw","value":[]}]}',
      ],
    );
  });

  it('asks the relay’s control plane by name, with the api version and the token, trusting the run’s authority', async () => {
    const folder = runFolder();
    makeRunCertificates(runCommand, folder, 'run.tunnels.test');
    const files = filesOf(folder);
    const seen: unknown[] = [];
    const server = createServer(
      {
        cert: readFileSync(files.certificateFile),
        key: readFileSync(files.keyFile),
      },
      (request, response) => {
        seen.push([
          request.url,
          request.headers.host,
          request.headers.authorization,
        ]);
        response.end('{"value":[]}');
      },
    ).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const answer = await relayGet(
      localStack(folder, (server.address() as AddressInfo).port),
      '/tunnels',
      TOKENS.listed,
    );
    server.close();
    rmSync(folder, {recursive: true, force: true});
    deepStrictEqual(
      {answer, seen},
      {
        answer: {status: 200, body: '{"value":[]}'},
        seen: [
          [
            '/tunnels?api-version=2023-09-27-preview',
            'cp.run.tunnels.test',
            'github stub-token-listed',
          ],
        ],
      },
    );
  });
});
