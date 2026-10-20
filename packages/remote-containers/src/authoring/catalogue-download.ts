/**
 * @fileoverview The download of the catalogue over an HTTP port the extension passes in: the extension host's own
 * `fetch`, which the editor patches to follow its proxy settings. Nothing here names a network module.
 */

/** What the download needs of an HTTP client: the extension host's `fetch` has this shape. */
export type HttpGet = (
  address: string,
  init: {signal: AbortSignal},
) => Promise<{status: number; text(): Promise<string>}>;

/** The text at an address over `httpGet`; it rejects with the cause in its message, and ends when its signal aborts. */
export function downloadTextOver(
  httpGet: HttpGet,
): (address: string, cancellation: AbortSignal) => Promise<string> {
  return async (address, cancellation) => {
    const response = await httpGet(address, {signal: cancellation});
    if (response.status !== 200) {
      throw new Error(`${address} answered ${String(response.status)}`);
    }
    return response.text();
  };
}
