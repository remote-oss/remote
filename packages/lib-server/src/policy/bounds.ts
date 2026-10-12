/**
 * @fileoverview The client download's named bounds: a stall bound that catches a hang, and generous ceilings against
 * a runaway, so no download that is slow but working is ended.
 */

import type {DownloadBounds} from '../transfer/ports.ts';

/**
 * The bounds of the client's download of a server archive: no bytes for a minute ends it, half an hour is the most it
 * may take in all, and a gibibyte is the most it may write when the response announces no length.
 */
export const CLIENT_DOWNLOAD_BOUNDS: DownloadBounds = {
  deadlineMilliseconds: 30 * 60 * 1000,
  stallMilliseconds: 60 * 1000,
  maximumBytes: 1024 * 1024 * 1024,
};
