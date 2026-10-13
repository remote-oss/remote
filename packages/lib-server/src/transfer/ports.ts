/** What the download's response announced about the body, to check it against. */
export interface DownloadFacts {
  /** The hex SHA-256 the redirect chain announced, in any letter case. */
  announcedSha256?: string;
  /** The number of bytes the response announced. */
  announcedLength?: number;
}

/** Why a download failed when a bound of the request ended it, rather than the network. */
export type DownloadFailureCause =
  'stalled' | 'deadline' | 'tooLarge' | 'httpStatus' | 'clientFile';

/** What a download on the client ended with. */
export type DownloadResult =
  | {
      kind: 'downloaded';
      facts: DownloadFacts;
      /** The address of the final response, after any redirects. */
      finalAddress: string;
    }
  | {
      kind: 'failed';
      detail: string;
      cause?: DownloadFailureCause;
      /** The HTTP status of an error answer, with the cause `httpStatus`. */
      status?: number;
    }
  | {kind: 'cancelled'};

/** The limits of one download, which the policy gives and the port enforces. */
export interface DownloadBounds {
  /** The most the whole download may take; the library ends the wait at this time even if the port does not. */
  deadlineMilliseconds: number;
  /** The longest the body may stay silent: a download that receives no bytes for this long ends as `stalled`. */
  stallMilliseconds: number;
  /**
   * The most bytes the body may have. A body longer than the length the response announced, or longer than this
   * ceiling when it announced none, ends as `tooLarge`.
   */
  maximumBytes: number;
}

/** One download: the archive at `address`, written to the file `destination`, its folders created as needed. */
export interface DownloadRequest extends DownloadBounds {
  address: string;
  destination: string;
  /** Ends the download: the caller's cancellation, and the deadline. */
  cancellation: AbortSignal;
  /**
   * The hosts the download may be redirected through and end on. The port stops at the first redirect to another
   * host; the library checks the final address again.
   */
  allowedHosts: readonly string[];
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
   * when the promise settles, a cancellation included, because the caller deletes it right after. A download that
   * the deadline cut may leave its temporary file where the system still holds it open (on Windows); the sweep of the
   * cache folder removes such leftovers.
   */
  download(request: DownloadRequest): Promise<DownloadResult>;
}

/** The client's files the transfer creates, checks, keeps or removes. */
export interface ClientFilePort {
  /** Deletes a file; a file that does not exist is not an error. A failure to delete is ignored by the caller. */
  remove(file: string): Promise<void>;
  /** Whether a file exists. */
  exists(file: string): Promise<boolean>;
  /** The size of a file in bytes. */
  size(file: string): Promise<number>;
  /** The SHA-256 of a file's bytes as lower-case hex. */
  sha256(file: string): Promise<string>;
  /**
   * Renames a file in one step, so that no reader sees a half-written destination. A failure carries its text; a
   * destination that already exists may be replaced or may be a failure.
   */
  rename(
    source: string,
    destination: string,
  ): Promise<{kind: 'renamed'} | {kind: 'failed'; detail: string}>;
}
