/**
 * @fileoverview Who the host is, for the rows that build an image around the host's user: a Linux host has a user and a
 * group id, which the UID/GID synchronisation of F-0403 BR-6 gives the remote user; a host without them (Windows) has
 * no such synchronisation, and the configuration's image is used as it is.
 */

/** What a row needs of the host's identity. */
export interface HostIdentity {
  /** The user id the remote user has in the image, and in the container. */
  userId: number;
  /** The group id the remote user has in the image, and in the container. */
  groupId: number;
  /** Whether the dev container CLI builds a derived `-uid` image for this host (Linux hosts only, F-0403 BR-6). */
  synchronised: boolean;
}

/** The user and group id F-0403 AC-11 gives the remote user where the host has none to give. */
const DEFAULT_REMOTE_ID = 1000;

/** The identity of a host whose process exposes `getuid` and `getgid` when it has them. */
export function hostIdentityOf(host: {
  getuid?: () => number;
  getgid?: () => number;
}): HostIdentity {
  const userId = host.getuid?.();
  const groupId = host.getgid?.();
  return userId === undefined || groupId === undefined
    ? {
        userId: DEFAULT_REMOTE_ID,
        groupId: DEFAULT_REMOTE_ID,
        synchronised: false,
      }
    : {userId, groupId, synchronised: true};
}
