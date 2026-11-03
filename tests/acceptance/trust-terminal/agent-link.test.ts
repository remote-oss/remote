/**
 * @fileoverview F-2311 AC-25 (card coverage-99): the agent link of a window on an untrusted
 * folder in terminal mode, which waits for core's trust modal.
 */

import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {
  agentAdd,
  closeWindow,
  isTrusted,
  onHostAs,
  openWindow,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {hostLinks, LINK_PATTERN} from '../windows/agent-links.ts';
import {INSTALL_MILLISECONDS} from '../windows/maintenance.ts';
import {dialogOf, statusItemText} from '../windows/renderer.ts';
import {keepingSettings} from '../windows/tunnel-support.ts';

/** The alias that forwards the run's agent. */
const ALIAS = 'agentfwd';

/** The time the link has after the answer or the indicator. */
const LINK_MILLISECONDS = 2000;

/** The key of the run that the agent holds. */
function keyFile(): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'id_second');
}

/** Waits up to `milliseconds` for a link on the host and gives the links there are. */
async function linksWithin(milliseconds: number): Promise<string[]> {
  await waitFor(
    'the agent link',
    async () => (await hostLinks()).length > 0,
    milliseconds,
  ).catch(() => undefined);
  return hostLinks();
}

describe('the agent link of a window on an untrusted folder in terminal mode (card coverage-99)', function () {
  this.timeout(300_000);

  it('F-2311 AC-25 (c99-trust-allowed): with terminals allowed in an untrusted workspace no question appears, the window stays in Restricted Mode, and the link exists within 2 s of the indicator', async () => {
    await keepingSettings(async () => {
      await userSettings({
        'terminal.integrated.allowInUntrustedWorkspace': true,
      });
      await agentAdd(keyFile(), {confirm: false});
      await onHostAs('root', 'sh', '-c', `rm -f ${LINK_PATTERN}`);
      await openWindow(ALIAS, 'c99-trust-allowed');
      try {
        await statusItemText(
          'c99-trust-allowed',
          'status.host',
          `SSH: ${ALIAS}`,
          INSTALL_MILLISECONDS,
        );
        const links = await linksWithin(LINK_MILLISECONDS);
        deepStrictEqual(
          {
            dialog: await dialogOf('c99-trust-allowed'),
            links: links.length,
            trusted: await isTrusted('c99-trust-allowed'),
          },
          {dialog: undefined, links: 1, trusted: false},
        );
      } finally {
        await closeWindow('c99-trust-allowed').catch(() => undefined);
      }
    });
  });
});
