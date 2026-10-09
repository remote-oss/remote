/** What a download on the client ended with. */
export type DownloadResult =
  {kind: 'downloaded'} | {kind: 'failed'; detail: string} | {kind: 'cancelled'};

/** One download: the archive at `address`, written to the file `destination`. */
export interface DownloadRequest {
  address: string;
  destination: string;
  cancellation: AbortSignal;
  /** Receives the share downloaded so far, an integer from 0 to 100, while the body arrives. */
  onPercent: (percent: number) => void;
}

/**
 * The client's network access, wired by the extension to the editor's proxy-aware path. The library makes no
 * request of its own and reads no proxy setting.
 */
export interface DownloadPort {
  /**
   * Downloads the archive. A failure carries the text the user is shown with it. The file is no longer written to
   * when the promise settles, a cancellation included, because the caller deletes it right after.
   */
  download(request: DownloadRequest): Promise<DownloadResult>;
}

/** The client's files the transfer creates, which it removes again. */
export interface ClientFilePort {
  /** Deletes a file; a file that does not exist is not an error. A failure to delete is ignored by the caller. */
  remove(file: string): Promise<void>;
}
