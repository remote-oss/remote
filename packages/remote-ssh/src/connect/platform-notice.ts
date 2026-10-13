/**
 * @fileoverview The notice that goes with the write of `remote.SSH.remotePlatform`: it says which platform was stored,
 * offers "Don't Show Again", and remembers that answer in the extension's global state.
 */

import type {Logger} from 'lib-log';
import type {AcceptanceState} from '../surfaces/acceptance-store.ts';
import type {NoticePort} from '../surfaces/notice.ts';
import {ownText} from '../surfaces/own-strings.ts';
import type {Translate} from '../surfaces/strings.ts';

/** The key of the global state that holds the user's wish not to see the notice again. */
export const SUPPRESS_PLATFORM_NOTICE_KEY =
  'suppressRemotePlatformNotification';

/** What announcing the platform is made from. */
export interface PlatformNoticeDependencies {
  notice: NoticePort;
  state: AcceptanceState;
  translate: Translate;
  logger: Logger;
}

/** The id of the label of the notice's one button. */
const DONT_SHOW_AGAIN_ID = 'S039';

/**
 * Shows the notice for the stored `platform` unless the user asked not to see it, and stores that wish when the
 * button is taken. It is not awaited by the connect: a failure of the notice or of the state is logged, never thrown.
 */
export function announcePlatform(
  dependencies: PlatformNoticeDependencies,
  platform: string,
): void {
  const {notice, state, translate, logger} = dependencies;
  if (state.get(SUPPRESS_PLATFORM_NOTICE_KEY) === true) {
    return;
  }
  const button = ownText({id: DONT_SHOW_AGAIN_ID, values: []}, translate);
  // The text has no id in the strings table of the product, so it is one of our own.
  const message = ownText(
    {id: 'platformStoredNotice', values: [platform]},
    translate,
  );
  void (async () => {
    try {
      const taken = await notice.showInformation(message, [button]);
      if (taken === button) {
        await state.update(SUPPRESS_PLATFORM_NOTICE_KEY, true);
      }
    } catch (caught) {
      logger.warn(
        `the platform notice did not work: ${(caught as Error).message}`,
      );
    }
  })();
}
