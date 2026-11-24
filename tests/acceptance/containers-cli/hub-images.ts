/**
 * @fileoverview The Docker Hub image the rows of this suite pull at run time, through Google's mirror of Docker Hub,
 * which hosted runners are not limited on (an anonymous read of Docker Hub itself answers 429 from a shared runner
 * address): the repository with the digest of its index, which the mirror serves as Docker Hub does.
 */

/** Alpine 3.22 by the digest of its index that the run's tools already pin for the same tag. */
export const ALPINE_3_22 =
  'mirror.gcr.io/library/alpine@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8';
