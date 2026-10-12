/**
 * @fileoverview The client platform, named here because its file locations and path separators differ from the
 * host's, and both the configuration model and the argument builder need it.
 */

/** The client platform whose file locations and path separators differ. */
export type ClientPlatform = 'linux' | 'macOS' | 'windows';
