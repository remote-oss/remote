/**
 * @fileoverview The control manifest of the acceptance run.
 */

import {deepStrictEqual} from 'node:assert';
import {controlManifestText} from './acceptance-control-manifest.ts';

describe('controlManifestText', () => {
  it("tooling-62: the run's registry is written in place of every placeholder, and the text is a manifest with two disallowed Features and one advisory", () => {
    const text = controlManifestText('localhost:49200');
    const manifest = JSON.parse(text) as {
      disallowedFeatures: Array<{
        featureIdPrefix: string;
        documentationURL?: string;
      }>;
      featureAdvisories: Array<{
        featureId: string;
        introducedInVersion: string;
        fixedInVersion: string;
      }>;
    };
    deepStrictEqual(
      [
        text.includes('<registry>'),
        manifest.disallowedFeatures.map(each => [
          each.featureIdPrefix,
          each.documentationURL !== undefined,
        ]),
        manifest.featureAdvisories.map(each => [
          each.featureId,
          each.introducedInVersion,
          each.fixedInVersion,
        ]),
      ],
      [
        false,
        [
          ['ghcr.io/devcontainers/features/disallowed-feature', true],
          ['localhost:49200/remote-oss-run/features/lab-banned-nodoc', false],
        ],
        [
          [
            'localhost:49200/remote-oss-run/features/lab-advised',
            '1.0.0',
            '1.0.1',
          ],
        ],
      ],
    );
  });
});
