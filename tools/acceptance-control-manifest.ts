/**
 * @fileoverview The control manifest of the acceptance run: what the dev container CLI and the product read in place of
 * the published one at https://containers.dev/static/devcontainer-control-manifest.json. It lists one disallowed Feature
 * with a documentation address, one without, and an advisory for one of the run's own Features.
 */

/** The placeholder of the run's registry in the manifest's Feature ids. */
const REGISTRY_PLACEHOLDER = '<registry>';

/** The run's control manifest, with `<registry>` standing for the run's registry. */
const RUN_CONTROL_MANIFEST = {
  disallowedFeatures: [
    {
      featureIdPrefix: 'ghcr.io/devcontainers/features/disallowed-feature',
      documentationURL:
        'https://github.com/devcontainers/features/tree/main/src/disallowed-feature#readme',
    },
    {
      featureIdPrefix: '<registry>/remote-oss-run/features/lab-banned-nodoc',
    },
  ],
  featureAdvisories: [
    {
      featureId: '<registry>/remote-oss-run/features/lab-advised',
      introducedInVersion: '1.0.0',
      fixedInVersion: '1.0.1',
      description: 'The run’s advisory for lab-advised.',
    },
  ],
};

/** The manifest as JSON text, with `registry` in the place of `<registry>`. */
export function controlManifestText(registry: string): string {
  return `${JSON.stringify(RUN_CONTROL_MANIFEST, undefined, 2).replaceAll(REGISTRY_PLACEHOLDER, registry)}\n`;
}
