/**
 * @fileoverview The test of a host path that is absolute: the install path of a plan and the data folder of a shared
 * record are read through it, so that the two never disagree about what a host path is.
 */

/** The absolute forms of a host path: a POSIX root, or a Windows drive followed by its separator. */
export const ABSOLUTE_HOST_PATH = /^(\/|[A-Za-z]:[\\/])/u;
