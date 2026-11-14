import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {closureFolders, shippedSources} from './string-tables.ts';

const ROOT = path.join(import.meta.dirname, '..');

/** The texts of core's agent-host settings and storage that no shipped source of Remote - SSH may name. */
const CORE_TEXTS = [
  'chat.remoteAgentHost',
  'chat.sshRemoteAgentHostCommand',
  'chat.agentHost',
  'remoteAgentHost.sshConnections',
];

describe('Remote - SSH beside core’s agent hosts (card #2500, F-2008 AC-8, BR-2)', () => {
  it('F-2008 AC-8 (c2500-no-core-keys): no shipped source of remote-ssh or of a workspace library in its dependency closure names core’s agent-host keys', () => {
    const files = closureFolders(ROOT, 'remote-ssh').flatMap(folder =>
      shippedSources(path.join(ROOT, 'packages', folder)).map(file =>
        path.join('packages', folder, file),
      ),
    );
    deepStrictEqual(
      files.filter(file => {
        const text = readFileSync(path.join(ROOT, file), 'utf8');
        return CORE_TEXTS.some(core => text.includes(core));
      }),
      [],
    );
  });
});
