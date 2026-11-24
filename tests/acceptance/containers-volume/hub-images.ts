/**
 * @fileoverview The Docker Hub image the rows of this suite pull at run time, through Google's mirror of Docker Hub,
 * which hosted runners are not limited on (an anonymous read of Docker Hub itself answers 429 from a shared runner
 * address): the repository with the digest of its index, which the mirror serves as Docker Hub does.
 */

/** Alpine 3.20 by the digest of its index. */
export const ALPINE_3_20 =
  'mirror.gcr.io/library/alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc';
