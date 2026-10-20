/**
 * @fileoverview Whether a configuration's image and Dockerfile entries have the types the devcontainer.json schema
 * gives them. The dev container CLI takes a number as an image name, so the connect checks these itself.
 */

/** Whether `value` is absent or a string. */
function absentOrString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

/**
 * Whether `configuration`'s `image`, `dockerFile` and `build.dockerfile` are each absent or a string. A `build` that
 * isn't an object, and every other property, are not checked here.
 */
export function sourceTypesValid(
  configuration: Readonly<Record<string, unknown>>,
): boolean {
  const {build} = configuration;
  const dockerfile =
    typeof build === 'object' && build !== null && !Array.isArray(build)
      ? (build as Record<string, unknown>).dockerfile
      : undefined;
  return (
    absentOrString(configuration.image) &&
    absentOrString(configuration.dockerFile) &&
    absentOrString(dockerfile)
  );
}
