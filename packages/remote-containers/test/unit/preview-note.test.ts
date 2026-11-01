import {deepStrictEqual} from 'node:assert';
import {previewNoteOf} from '../../src/connect/preview-note.ts';

describe('previewNoteOf', () => {
  it('F-0502 7.E6: Alpine, arm64 and both are named, and any other platform has no note', () => {
    deepStrictEqual(
      [
        previewNoteOf({operatingSystem: 'alpine', architecture: 'x64'}),
        previewNoteOf({operatingSystem: 'linux', architecture: 'arm64'}),
        previewNoteOf({operatingSystem: 'alpine', architecture: 'arm64'}),
        previewNoteOf({operatingSystem: 'linux', architecture: 'x64'}),
        previewNoteOf({operatingSystem: 'darwin', architecture: 'x64'}),
      ],
      ['Alpine Linux', 'ARM64', 'Alpine Linux ARM64', undefined, undefined],
    );
  });
});
