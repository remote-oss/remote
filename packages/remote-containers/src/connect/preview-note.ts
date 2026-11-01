/**
 * @fileoverview The preview-tier platforms of a created container, and the line the log tells for them.
 */

/** The text of the log line, which no string table holds. */
export const PREVIEW_TEMPLATES = {
  previewNote: 'Support for {0} is in preview.',
} as const;

/**
 * The name of the preview tier a container's platform is in, as the log says it: `Alpine Linux`, `ARM64` or
 * `Alpine Linux ARM64`; nothing for any other platform, a glibc distribution on x64 among them.
 */
export function previewNoteOf(platform: {
  operatingSystem: string;
  architecture: string;
}): string | undefined {
  const names = [
    ...(platform.operatingSystem === 'alpine' ? ['Alpine Linux'] : []),
    ...(platform.architecture === 'arm64' ? ['ARM64'] : []),
  ];
  return names.length === 0 ? undefined : names.join(' ');
}
