import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
  onHostAs,
  openWindow,
  recordLines,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {hintRecords} from '../windows/hint-store.ts';
import {
  closeAllButLocal,
  dismissals,
  freshHost,
} from '../windows/maintenance.ts';
import {keepingSettings, PLATFORMS} from '../windows/tunnel-support.ts';

/** STR:S049 and STR:S050 with the setting's name filled in. */
const LOCALLY =
  'Enable remote.SSH.localServerDownload to allow VS Code to download the required resources locally';
const VIA_LOCAL_MACHINE =
  'Enable remote.SSH.localServerDownload to allow VS Code to download the required resources via your local machine and then upload them to the remote server';

/** The mitigations of every hint the extension has stored. */
function storedMitigations(): string[] {
  return hintRecords().flatMap(record =>
    record.hints.flatMap(hint => hint.mitigations ?? []),
  );
}

/** Opens window `name` on the host under `template` with the local download off, and waits until its failure is in the hint store. */
async function failedWith(
  name: string,
  template: string,
  wanted: string,
): Promise<string[]> {
  await freshHost();
  await userSettings({
    ...PLATFORMS,
    'remote.SSH.serverDownloadUrlTemplate': template,
    'remote.SSH.localServerDownload': 'off',
  });
  appendScript(dismissals(name));
  await openWindow('harness', name);
  try {
    await waitFor(
      'the failure dialog',
      () => recordLines('failureDialog', name).length > 0,
      180_000,
    );
    await waitFor(
      'the stored hint',
      () => storedMitigations().includes(wanted),
      60_000,
    ).catch(() => undefined);
    return storedMitigations();
  } finally {
    await closeWindow(name).catch(() => undefined);
  }
}

describe('the hints of a host download that fails with the local download off (card coverage-87)', function () {
  this.timeout(600_000);

  after(async () => {
    await closeAllButLocal();
  });

  it('F-2405 AC-20 (c87-hint-404): a host download that fails with local download off stores a hint whose mitigations include S049', async () => {
    await keepingSettings(async () => {
      const mitigations = await failedWith(
        'c87-hint-404',
        `${variable('HARNESS_DOWNLOADS_HTTP')}/missing/\${os}-\${arch}/\${commit}`,
        LOCALLY,
      );
      deepStrictEqual(
        mitigations.includes(LOCALLY),
        true,
        JSON.stringify(mitigations),
      );
    });
  });

  it('F-2405 AC-20 (c87-hint-nofetch): a host with neither curl nor wget and local download off stores a hint whose mitigations include S050', async () => {
    await keepingSettings(async () => {
      await onHostAs(
        'root',
        'sh',
        '-c',
        'for t in curl wget; do p=$(command -v $t); [ -n "$p" ] && mv $p $p.off; done; true',
      );
      try {
        const mitigations = await failedWith(
          'c87-hint-nofetch',
          `${variable('HARNESS_DOWNLOADS_LOCAL')}/ok/\${os}-\${arch}/\${commit}`,
          VIA_LOCAL_MACHINE,
        );
        deepStrictEqual(
          mitigations.includes(VIA_LOCAL_MACHINE),
          true,
          JSON.stringify(mitigations),
        );
      } finally {
        await onHostAs(
          'root',
          'sh',
          '-c',
          'for t in curl wget; do for p in /usr/bin/$t /bin/$t; do [ -e $p.off ] && mv $p.off $p; done; done; true',
        );
      }
    });
  });
});
