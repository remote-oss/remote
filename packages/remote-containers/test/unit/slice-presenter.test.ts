import {deepStrictEqual} from 'node:assert';
import type {Failed} from 'lib-authority';
import {
  containerSetupFailed,
  engineCheckFailed,
  malformedAuthority,
  noServerSource,
  requirementsNotMet,
  unsupportedPlatform,
} from '../../src/connect/failures.ts';
import {slicePresenterOf} from '../../src/connect/slice-presenter.ts';

/** A presenter whose dialog answers `chosen`, with what it showed and opened. */
function presenting(chosen: string | undefined) {
  const shown: unknown[] = [];
  const opened: string[] = [];
  const presenter = slicePresenterOf(
    {
      showError: (message, detail, items) => {
        shown.push([message, detail, items]);
        return Promise.resolve(chosen);
      },
      openSetting: setting => {
        opened.push(setting);
        return Promise.resolve();
      },
    },
    template => template,
  );
  return {presenter, shown, opened};
}

async function outcomeOf(failed: Failed, chosen: string | undefined) {
  const {presenter, shown, opened} = presenting(chosen);
  return {outcome: await presenter.present(failed), shown, opened};
}

describe('the presenter of slice 1 (card containers-08)', () => {
  it('F-0410: a failure is one modal with no message line, the reason as its detail and Retry', async () => {
    deepStrictEqual(
      (await outcomeOf(containerSetupFailed(), undefined)).shown,
      [['', 'An error occurred setting up the container.', ['Retry']]],
    );
  });

  it('F-0410: Retry reloads the window and Escape leaves it as it is', async () => {
    deepStrictEqual(
      [
        (await outcomeOf(containerSetupFailed(), 'Retry')).outcome,
        (await outcomeOf(containerSetupFailed(), undefined)).outcome,
      ],
      ['reload', 'handled'],
    );
  });

  it('F-0202: the second check’s reasons are shown with their own texts', async () => {
    deepStrictEqual(
      [
        (await outcomeOf(engineCheckFailed('S339'), undefined)).shown[0],
        (await outcomeOf(engineCheckFailed('S104'), undefined)).shown[0],
        (await outcomeOf(engineCheckFailed('S144'), undefined)).shown[0],
      ],
      [
        [
          '',
          "The 'docker' command was not found. Make sure Docker is installed.",
          ['Retry'],
        ],
        [
          '',
          "Current user does not have permission to run 'docker'. Try adding the user to the 'docker' group.",
          ['Retry'],
        ],
        [
          '',
          'Docker returned an error. Make sure the Docker daemon is running and select an option how to proceed.',
          ['Retry'],
        ],
      ],
    );
  });

  it('F-0503 7.E3: an unsupported machine names its architecture, in the Alpine text or the other', async () => {
    deepStrictEqual(
      [
        (await outcomeOf(unsupportedPlatform('S031', 'armv7l'), undefined))
          .shown[0],
        (await outcomeOf(unsupportedPlatform('S359', 'armv7l'), undefined))
          .shown[0],
      ],
      [
        [
          '',
          "Alpine Linux is not supported on the hardware architecture 'armv7l' of the container.",
          ['Retry'],
        ],
        [
          '',
          "The hardware architecture 'armv7l' of the container is not supported.",
          ['Retry'],
        ],
      ],
    );
  });

  it('F-0503 7.E1: unmet requirements have the message S346 and the check’s text as the detail', async () => {
    deepStrictEqual(
      (await outcomeOf(requirementsNotMet('libstdc++ missing'), undefined))
        .shown[0],
      [
        'The container does not meet all the requirements of the VS Code Server.',
        'libstdc++ missing',
        ['Retry'],
      ],
    );
  });

  it('F-0503 BR-14(e): no server source gets Open Setting and Cancel, and Open Setting opens the setting', async () => {
    const opened = await outcomeOf(noServerSource('VSCodium'), 'Open Setting');
    deepStrictEqual(
      [opened.shown, opened.outcome, opened.opened],
      [
        [
          [
            '',
            "remote-oss.remote-containers has no built-in VS Code Server download location for VSCodium. Set remote.serverDownloadBaseUrl to a URL template for this editor's own server builds.",
            ['Open Setting', 'Cancel'],
          ],
        ],
        'handled',
        ['remote.serverDownloadBaseUrl'],
      ],
    );
  });

  it('F-0503 BR-14(e): Cancel and Escape open nothing and leave the window as it is', async () => {
    const cancelled = await outcomeOf(noServerSource('VSCodium'), 'Cancel');
    const escaped = await outcomeOf(noServerSource('VSCodium'), undefined);
    deepStrictEqual(
      [cancelled.outcome, cancelled.opened, escaped.outcome, escaped.opened],
      ['handled', [], 'handled', []],
    );
  });

  it('F-0410: a failure with no reason has an empty detail', async () => {
    deepStrictEqual((await outcomeOf(malformedAuthority(), undefined)).shown, [
      ['', '', ['Retry']],
    ]);
  });
});
