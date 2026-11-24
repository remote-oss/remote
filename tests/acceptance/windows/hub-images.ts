/**
 * @fileoverview The Docker Hub images the rows pull at run time, through Google's mirror of Docker Hub, which hosted
 * runners are not limited on (an anonymous read of Docker Hub itself answers 429 from a shared runner address). Each is
 * the repository with the digest of its index, which the mirror serves as Docker Hub does.
 */

/** Alpine 3.22 by the digest of its index that the run's tools already pin for the same tag. */
export const ALPINE_3_22 =
  'mirror.gcr.io/library/alpine@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8';

/** Alpine 3.20 by the digest of its index. */
export const ALPINE_3_20 =
  'mirror.gcr.io/library/alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc';
