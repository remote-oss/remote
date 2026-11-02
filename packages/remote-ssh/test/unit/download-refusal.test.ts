import {deepStrictEqual} from 'node:assert';
import {downloadRefusalHint} from '../../src/diagnostics/download-refusal.ts';
import {ownText} from '../../src/surfaces/own-strings.ts';

const SETTING = 'remote.SSH.localServerDownload';

/** The texts of the hint's mitigations, as the recorder would store them. */
function mitigationsOf(cause: 'downloadFailed' | 'noDownloader'): string[] {
  return downloadRefusalHint(cause, template => template).mitigations.map(
    each => ownText(each, template => template),
  );
}

describe('the hints of a refused host download (card connect-121)', () => {
  it('F-2405 AC-20, 7.E1: a failed download has its status, its message and the connectivity topic as its one resource', () => {
    const hint = downloadRefusalHint('downloadFailed', template => template);
    deepStrictEqual(
      [hint.status, hint.message, hint.resources, hint.details],
      [
        'ServerDownloadFailed',
        'A VS Code Server matching your local installation could not be downloaded from the internet. (Downloading VS Code Server failed. Please try again later.)',
        ['hangingOrFailingConnections'],
        undefined,
      ],
    );
  });

  it('F-2405 AC-20, 7.E1: the five mitigations are in order, the third naming the setting', () => {
    deepStrictEqual(mitigationsOf('downloadFailed'), [
      'Ensure that the remote server has internet access and has access to the VS Code CDN',
      'If your remote server is behind a firewall, ask your IT department to allow access to the VS Code CDN',
      `Enable ${SETTING} to allow VS Code to download the required resources locally`,
      "If your remote server is behind a proxy, provide the proxy URL with setting 'remote.SSH.httpProxy' or 'remote.SSH.httpsProxy'",
      'Update VS Code and try again later',
    ]);
  });

  it('F-2405 AC-20, 7.E2: a host with neither tool has its status, its message, no details and no resource', () => {
    const hint = downloadRefusalHint('noDownloader', template => template);
    deepStrictEqual(
      [hint.status, hint.message, hint.details, hint.resources],
      [
        'NoDownloaderAvailable',
        'When first establishing a connection to the remote server, various resources must be installed from the internet. A program (either "wget" or "curl") is used to download these resources, but they are not installed on the remote server.  When this step fails, the extension attempts to use the local machine to download the resources and then upload them to the remote server. (Downloading VS Code Server failed - please install either curl or wget on the remote.)',
        undefined,
        [],
      ],
    );
  });

  it('F-2405 AC-20, 7.E2: the five mitigations are in order, the fifth naming the setting', () => {
    deepStrictEqual(mitigationsOf('noDownloader'), [
      "Install 'wget' on the remote server. Installation steps will vary per distribution.",
      "Install 'curl' on the remote server. Installation steps will vary per distribution.",
      "Ensure curl/wget are on the remote system's 'PATH'",
      'Ensure that the remote server has internet access and that the network is not blocking the download',
      `Enable ${SETTING} to allow VS Code to download the required resources via your local machine and then upload them to the remote server`,
    ]);
  });
});
