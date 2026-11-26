/**
 * @fileoverview The Docker Hub images the harness and the acceptance rows pull, each by the digest of its index. This is
 * where a re-pin is made: a row asks for an image here and reads the digest from nothing else.
 */

/** The digest of the index of each image the harness pins. */
const DIGESTS = {
  'alpine:3.20':
    'sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc',
  'alpine:3.22':
    'sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8',
} as const;

/** An image the harness pins. */
export type PinnedImage = keyof typeof DIGESTS;

/** `image` with its digest, as a dev container configuration or the Docker CLI names it. */
export function pinnedImage(image: PinnedImage): string {
  return `${image}@${DIGESTS[image]}`;
}

/**
 * `image` through Google's mirror of Docker Hub, which hosted runners are not limited on (an anonymous read of Docker
 * Hub itself answers 429 from a shared runner address): the repository with the digest of its index, which the mirror
 * serves as Docker Hub does. The Docker CLI cannot parse a tag together with a digest here, so the tag is left out.
 */
export function hubImage(image: PinnedImage): string {
  return `mirror.gcr.io/library/${image.slice(0, image.indexOf(':'))}@${DIGESTS[image]}`;
}
